import { config as dotEnvConfig } from 'dotenv'
dotEnvConfig()

import '@typechain/hardhat'
import '@nomiclabs/hardhat-etherscan'
import '@nomiclabs/hardhat-ethers'
import '@nomiclabs/hardhat-waffle'
import 'hardhat-gas-reporter'
import 'solidity-coverage'

import { HardhatUserConfig } from 'hardhat/types'
import { MNEMONIC, ETHERSCAN_API_KEY } from './constants'

import './tasks/accounts'

const config: HardhatUserConfig = {
  defaultNetwork: 'hardhat',
  solidity: {
    compilers: [
      {
        version: '0.8.12',
        settings: {
          optimizer: {
            enabled: true,
            runs: 9999,
          },
          outputSelection: {
            '*': {
              '*': ['storageLayout'],
            },
          },
        },
      },
    ],
  },
  networks: {
    hardhat: {
      allowUnlimitedContractSize: true,
      forking: {
        url: 'https://rpc.ankr.com/fantom',
        blockNumber: 43868128,
      },
    },
    ftm_testnet: {
      url: 'https://rpc.testnet.fantom.network/',
      chainId: 0xfa2,
      accounts: { mnemonic: MNEMONIC },
    },
    ftm_mainnet: {
      url: 'https://rpc.ankr.com/fantom/',
      chainId: 250,
      accounts: { mnemonic: MNEMONIC },
    },
  },
  etherscan: {
    apiKey: ETHERSCAN_API_KEY,
  },
  gasReporter: {
    enabled: false,
    currency: 'eth',
  },
  typechain: {
    outDir: 'typechain',
    target: 'ethers-v5',
  },
  mocha: {
    timeout: 0,
  },
}

export default config
