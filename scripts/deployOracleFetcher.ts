/* eslint-disable no-console */
import hre from 'hardhat'
import { ROUTER_ADDRESS, USDC_ADDRESS, WNATIVE_ADDRESS } from '../constants'
import { failableVerify, readContractAddresses, writeContractAddresses } from '../test/utils'

async function main() {
  const [signer] = await hre.ethers.getSigners()
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const chainId = hre.network.config.chainId!

  // Get Deployed Involica
  const [involicaAddress] = readContractAddresses(chainId, ['involica'])

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

  // FETCHER
  const InvolicaFetcherFactory = await hre.ethers.getContractFactory('InvolicaFetcher', signer)

  const fetcherConstructorArgs = [involicaAddress, oracle.address]
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
    ['fetcher', fetcher.address],
    ['oracle', oracle.address],
  ])
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
