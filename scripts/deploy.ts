/* eslint-disable no-console */
import hre from 'hardhat'
import { OPS_ADDRESS, ROUTER_ADDRESS, WETH_ADDRESS } from '../constants'

// eslint-disable-next-line @typescript-eslint/ban-types
export const failableVerify = async (args: Object): Promise<void> => {
  try {
    await hre.run('verify:verify', args)
  } catch (err: any) {
    console.log('Verify Failed: ', err.message)
  }
}

async function main() {
  const [signer] = await hre.ethers.getSigners()
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const chainId = hre.network.config.chainId!

  // DEPLOY INVOLICA
  const InvolicaFactory = await hre.ethers.getContractFactory('Involica', signer)

  const involicaConstructorArgs = [signer, OPS_ADDRESS[chainId], ROUTER_ADDRESS[chainId], WETH_ADDRESS[chainId]]
  const involica = await InvolicaFactory.deploy(...involicaConstructorArgs)
  await involica.deployed()
  console.log('Involica deployed to:', involica.address)

  // VERIFY INVOLICA
  await failableVerify({
    address: involica.address,
    constructorArguments: involicaConstructorArgs,
  })

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
  await involica.setResolver(resolver.address)
  console.log('Involica resolver set:', resolver.address)
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
