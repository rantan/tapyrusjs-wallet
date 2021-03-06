import * as tapyrus from 'tapyrusjs-lib';

import { Balance } from '../src/balance';
import { Config } from '../src/config';
import { BaseWallet } from '../src/wallet';
import { KeyStore } from '../src/key_store';
import { DataStore } from '../src/data_store';
import { Utxo } from '../src/utxo';
import * as util from '../src/util';
import * as sinon from 'sinon';

export class LocalKeyStore implements KeyStore {
  _wifKeys: string[] = [];
  _extKeys: string[] = [];
  network: tapyrus.networks.Network;

  constructor(network: tapyrus.networks.Network) {
    this.network = network;
  }

  async addPrivateKey(key: string): Promise<void> {
    this._wifKeys.push(key);
  }

  async addExtendedPrivateKey(extendedPrivateKey: string): Promise<void> {
    this._extKeys.push(extendedPrivateKey);
  }

  async keys(): Promise<string[]> {
    return this._wifKeys
      .map(wif => {
        return tapyrus.ECPair.fromWIF(wif, this.network).privateKey!.toString(
          'hex',
        );
      })
      .concat(
        this._extKeys.map(xpriv => {
          return tapyrus.bip32
            .fromBase58(xpriv, this.network)
            .privateKey!.toString('hex');
        }),
      );
  }

  clear() {
    this._wifKeys = [];
    this._extKeys = [];
  }
}

export class LocalDataStore implements DataStore {
  utxos: Utxo[] = [];

  async clear(): Promise<void> {
    this.utxos = [];
  }

  async add(utxos: Utxo[]): Promise<void> {
    this.utxos = this.utxos.concat(utxos);
  }

  async all(): Promise<Utxo[]> {
    return this.utxos;
  }

  async utxosFor(keys: string[], colorId?: string): Promise<Utxo[]> {
    const scripts = util.keyToScript(keys, colorId);
    return this.utxos.filter((utxo: Utxo) => {
      return scripts.find((script: string) => script == utxo.scriptPubkey);
    });
  }

  async balanceFor(keys: string[], colorId?: string): Promise<Balance> {
    const utxos = await this.utxosFor(keys, colorId);
    return util.sumBalance(utxos, colorId);
  }
  async processTx(_keys: string[], _tx: tapyrus.Transaction): Promise<void> {
    return;
  }
}

export const createWallet = (
  network: string,
): {
  wallet: BaseWallet;
  keyStore: LocalKeyStore;
  dataStore: LocalDataStore;
} => {
  const config = new Config({
    host: 'example.org',
    port: '50001',
    path: '/',
    network,
  });
  const keyStore = new LocalKeyStore(config.network);
  const dataStore = new LocalDataStore();
  const wallet = new BaseWallet(keyStore, dataStore, config);
  return {
    wallet,
    keyStore,
    dataStore,
  };
};

export const setUpStub = (wallet: BaseWallet): sinon.SinonStub => {
  const stub = sinon.stub();
  wallet.rpc.request = (
    config: Config,
    method: string,
    params: any[],
    headers?: any,
  ) => {
    return stub(config, method, params, headers);
  };
  return stub;
};
