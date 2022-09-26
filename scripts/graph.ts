/* eslint-disable no-console */
import hre from 'hardhat'
import { readContractAddresses } from '../test/utils'

export const graph = async (): Promise<void> => {
  const chainId = 250
  const [involicaAdd] = readContractAddresses(chainId, ['involica'])
  console.log({
    involicaAdd,
  })
  hre.run('graph', { contractName: 'Involica', contractAddress: involicaAdd })
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
graph()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
