'use strict';
var __awaiter =
  (this && this.__awaiter) ||
  function(thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function(resolve, reject) {
      function fulfilled(value) {
        try {
          step(generator.next(value));
        } catch (e) {
          reject(e);
        }
      }
      function rejected(value) {
        try {
          step(generator['throw'](value));
        } catch (e) {
          reject(e);
        }
      }
      function step(result) {
        result.done
          ? resolve(result.value)
          : new P(function(resolve) {
              resolve(result.value);
            }).then(fulfilled, rejected);
      }
      step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
  };
Object.defineProperty(exports, '__esModule', { value: true });
const tapyrus = require('tapyrusjs-lib');
const rpc_1 = require('./rpc');
const signer_1 = require('./signer');
const token_1 = require('./token');
const util = require('./util');
const utxo_1 = require('./utxo');
// Wallet Implementation
class BaseWallet {
  constructor(keyStore, dataStore, config) {
    this.keyStore = keyStore;
    this.dataStore = dataStore;
    this.config = config;
    this.rpc = new rpc_1.Rpc();
  }
  importExtendedPrivateKey(xpriv) {
    return __awaiter(this, void 0, void 0, function*() {
      const restored = tapyrus.bip32.fromBase58(xpriv, this.config.network);
      const result = yield util.belongsToPrivateKeys(
        this.keyStore,
        restored.privateKey,
      );
      if (result) {
        return;
      }
      return this.keyStore.addExtendedPrivateKey(xpriv);
    });
  }
  importWif(wif) {
    return __awaiter(this, void 0, void 0, function*() {
      const keyPair = tapyrus.ECPair.fromWIF(wif, this.config.network);
      const result = yield util.belongsToPrivateKeys(
        this.keyStore,
        keyPair.privateKey,
      );
      if (result) {
        return;
      }
      return this.keyStore.addPrivateKey(wif);
    });
  }
  update() {
    return __awaiter(this, void 0, void 0, function*() {
      const keys = yield this.keyStore.keys();
      return Promise.all(keys.map(key => this.listUnspent(key).catch(_r => [])))
        .then(utxos => utxos.reduce((acc, val) => acc.concat(val), []))
        .then(utxos => {
          this.dataStore.clear().then(() => this.dataStore.add(utxos));
        });
    });
  }
  broadcast(tx, options) {
    return __awaiter(this, void 0, void 0, function*() {
      const response = yield this.rpc
        .request(
          this.config,
          'blockchain.transaction.broadcast',
          [tx.toHex()].concat((options || {}).params || []),
          (options || {}).headers,
        )
        .catch(reason => {
          throw new Error(reason);
        });
      const keys = yield this.keyStore.keys();
      yield this.dataStore.processTx(keys, tx);
      return response.toString();
    });
  }
  balance(colorId) {
    return __awaiter(this, void 0, void 0, function*() {
      const keys = yield this.keyStore.keys();
      return this.dataStore.balanceFor(keys, colorId);
    });
  }
  utxos(colorId) {
    return __awaiter(this, void 0, void 0, function*() {
      const keys = yield this.keyStore.keys();
      return this.dataStore.utxosFor(keys, colorId);
    });
  }
  transfer(params, changePubkeyScript, options) {
    return __awaiter(this, void 0, void 0, function*() {
      const txb = new tapyrus.TransactionBuilder();
      txb.setVersion(1);
      const inputs = [];
      const uncoloredScript = tapyrus.payments.p2pkh({
        output: changePubkeyScript,
      });
      for (const param of params) {
        const coloredUtxos = yield this.utxos(param.colorId);
        const { sum: sumToken, collected: tokens } = this.collect(
          coloredUtxos,
          param.amount,
        );
        const coloredScript = this.addressToOutput(
          param.toAddress,
          Buffer.from(param.colorId, 'hex'),
        );
        const changeColoredScript = tapyrus.payments.cp2pkh({
          hash: uncoloredScript.hash,
          colorId: Buffer.from(param.colorId, 'hex'),
        }).output;
        tokens.map(utxo => {
          txb.addInput(
            utxo.txid,
            utxo.index,
            undefined,
            Buffer.from(utxo.scriptPubkey, 'hex'),
          );
          inputs.push(utxo);
        });
        txb.addOutput(coloredScript, param.amount);
        txb.addOutput(changeColoredScript, sumToken - param.amount);
      }
      const uncoloredUtxos = yield this.utxos();
      const fee = this.estimatedFee(token_1.createDummyTransaction(txb));
      const { sum: sumTpc, collected: tpcs } = this.collect(
        uncoloredUtxos,
        fee,
      );
      tpcs.map(utxo => {
        txb.addInput(
          utxo.txid,
          utxo.index,
          undefined,
          Buffer.from(utxo.scriptPubkey, 'hex'),
        );
        inputs.push(utxo);
      });
      txb.addOutput(uncoloredScript.output, sumTpc - fee);
      const signedTxb = yield signer_1.sign(this, txb, inputs);
      const tx = signedTxb.build();
      yield this.broadcast(tx, options);
      return tx;
    });
  }
  estimatedFee(tx) {
    return this.config.feeProvider.fee(tx);
  }
  listUnspent(key) {
    return __awaiter(this, void 0, void 0, function*() {
      const [p2pkh, scripthash] = this.privateToScriptHash(
        Buffer.from(key, 'hex'),
      );
      const response = yield this.rpc.request(
        this.config,
        'blockchain.scripthash.listunspent',
        [Buffer.from(scripthash).toString('hex')],
      );
      return response.map(r => {
        if (r.color_id) {
          const cp2pkh = tapyrus.payments.cp2pkh({
            pubkey: p2pkh.pubkey,
            colorId: Buffer.from(r.color_id, 'hex'),
          });
          return new utxo_1.Utxo(
            r.tx_hash,
            r.height,
            r.tx_pos,
            cp2pkh.output.toString('hex'),
            r.color_id,
            r.value,
          );
        } else {
          return new utxo_1.Utxo(
            r.tx_hash,
            r.height,
            r.tx_pos,
            p2pkh.output.toString('hex'),
            BaseWallet.COLOR_ID_FOR_TPC,
            r.value,
          );
        }
      });
    });
  }
  // convert private key to scripthash
  privateToScriptHash(key) {
    const pair = tapyrus.ECPair.fromPrivateKey(key);
    const p2pkh = tapyrus.payments.p2pkh({
      pubkey: pair.publicKey,
    });
    return [p2pkh, tapyrus.crypto.sha256(p2pkh.output).reverse()];
  }
  // convert address to buffer of scriptPubkey
  addressToOutput(address, colorId) {
    if (colorId) {
      try {
        return tapyrus.payments.cp2pkh({ address }).output;
      } catch (e) {}
      try {
        const hash = tapyrus.payments.p2pkh({ address }).hash;
        return tapyrus.payments.cp2pkh({ hash, colorId }).output;
      } catch (e) {}
    } else {
      try {
        return tapyrus.payments.p2pkh({ address }).output;
      } catch (e) {}
    }
    throw new Error('Invalid address type.');
  }
  collect(utxos, amount) {
    let sum = 0;
    const collected = [];
    for (const utxo of utxos) {
      sum += utxo.value;
      collected.push(utxo);
      if (sum >= amount) {
        break;
      }
    }
    if (sum >= amount) {
      return { sum, collected };
    } else {
      throw new Error('Insufficient Token');
    }
  }
}
BaseWallet.COLOR_ID_FOR_TPC =
  '000000000000000000000000000000000000000000000000000000000000000000';
exports.BaseWallet = BaseWallet;
