/* eslint-disable no-console */
import hre, { ethers } from 'hardhat'
import { readContractAddresses } from '../test/utils'
import { InvolicaResolver } from '../typechain'

export const exitPosition = async (): Promise<void> => {
  const [signer] = await hre.ethers.getSigners()
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const chainId = hre.network.config.chainId!

  // Get Deployed Involica
  const [resolverAdd] = readContractAddresses(chainId, ['resolver'])
  const resolver = (await ethers.getContractAt('InvolicaResolver', resolverAdd)) as InvolicaResolver

  // const execConditions = await resolver.fetchPositionExecConditions(signer.address)

  // console.log(execConditions)
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
exitPosition()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
