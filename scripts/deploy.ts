/* eslint-disable no-console */
import hre from 'hardhat'
import { OPS_ADDRESS, ROUTER_ADDRESS, USDC_ADDRESS, WNATIVE_ADDRESS } from '../constants'
import { failableVerify, writeContractAddresses } from '../test/utils'

async function main() {
  const [signerOld, signer] = await hre.ethers.getSigners()
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const chainId = hre.network.config.chainId!

  // DEPLOY INVOLICA
  const InvolicaFactory = await hre.ethers.getContractFactory('Involica', signer)

  const involicaConstructorArgs = [
    signer.address,
    OPS_ADDRESS[chainId],
    ROUTER_ADDRESS[chainId],
    WNATIVE_ADDRESS[chainId],
  ]
  const involica = await InvolicaFactory.deploy(...involicaConstructorArgs)
  await involica.deployed()
  console.log('Involica deployed to:', involica.address)

  // VERIFY INVOLICA
  await failableVerify({
    address: involica.address,
    constructorArguments: involicaConstructorArgs,
  })

  // ORACLE
  const InvolicaOracleFactory = await hre.ethers.getContractFactory('Oracle', signer)

  const oracleConstructorArgs = [ROUTER_ADDRESS[chainId], WNATIVE_ADDRESS[chainId], USDC_ADDRESS[chainId]]
  const oracle = await InvolicaOracleFactory.deploy(...oracleConstructorArgs)
  await oracle.deployed()
  console.log('Oracle deployed to:', oracle.address)

  // VERIFY ORACLE
  await failableVerify({
    address: oracle.address,
    constructorArguments: oracleConstructorArgs,
  })

  // DEPLOY RESOLVER
  const InvolicaResolverFactory = await hre.ethers.getContractFactory('InvolicaResolver', signer)

  const resolverConstructorArgs = [involica.address, ROUTER_ADDRESS[chainId], oracle.address]
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

  // FETCHER
  const InvolicaFetcherFactory = await hre.ethers.getContractFactory('InvolicaFetcher', signer)

  const fetcherConstructorArgs = [involica.address, oracle.address]
  const fetcher = await InvolicaFetcherFactory.deploy(...fetcherConstructorArgs)
  await fetcher.deployed()
  console.log('Fetcher deployed to:', fetcher.address)

  // VERIFY FETCHER
  await failableVerify({
    address: fetcher.address,
    constructorArguments: fetcherConstructorArgs,
  })

  // WRITE CONTRACT ADDRESSES
  writeContractAddresses(chainId, [
    ['involica', involica.address],
    ['fetcher', fetcher.address],
    ['oracle', oracle.address],
    ['resolver', resolver.address],
    ['usdc', USDC_ADDRESS[chainId]],
    ['weth', WNATIVE_ADDRESS[chainId]],
  ])

  // await syncTokens()
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
