/* eslint-disable no-console */
import hre, { ethers } from 'hardhat'
import { ROUTER_ADDRESS } from '../constants'
import { failableVerify, readContractAddresses, writeContractAddresses } from '../test/utils'

async function main() {
  const [signer] = await hre.ethers.getSigners()
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const chainId = hre.network.config.chainId!

  // Get Deployed Involica
  const [involicaAddress] = readContractAddresses(chainId, ['involica'])
  const involica = await ethers.getContractAt('Involica', involicaAddress)

  // DEPLOY RESOLVER
  const InvolicaResolverFactory = await hre.ethers.getContractFactory('InvolicaResolver', signer)

  const resolverConstructorArgs = [involica.address, ROUTER_ADDRESS[chainId]]
  const resolver = await InvolicaResolverFactory.deploy(...resolverConstructorArgs)
  await resolver.deployed()
  console.log('Resolver deployed to:', resolver.address)

  // VERIFY RESOLVER
  await failableVerify({
    address: resolver.address,
    constructorArguments: resolverConstructorArgs,
  })

  // SET RESOLVER
  const setResolverTx = await involica.setResolver(resolver.address)
  await setResolverTx.wait()
  console.log('Involica resolver set:', resolver.address)

  // WRITE CONTRACT ADDRESSES
  writeContractAddresses(chainId, [['resolver', resolver.address]])
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
