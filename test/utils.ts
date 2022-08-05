import { BigNumber, BigNumberish, Contract } from 'ethers/lib/ethers'
import { ethers, network } from 'hardhat'
import {
  OPS_ADDRESS,
  ROUTER_ADDRESS,
  USDC_ADDRESS,
  USDC_DECIMALS,
  USDC_OWNING_WALLET,
  WBTC_ADDRESS,
  WETH_ADDRESS,
} from '../constants'
import {
  IERC20,
  Involica,
  InvolicaFetcher,
  InvolicaFetcher__factory,
  InvolicaResolver,
  InvolicaResolver__factory,
  Involica__factory,
  IOps,
  Oracle,
  Oracle__factory,
} from '../typechain'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { parseEther, parseUnits } from 'ethers/lib/utils'

export interface ThisObject {
  chainId: number
  signers: SignerWithAddress[]

  deployer: SignerWithAddress
  alice: SignerWithAddress
  bob: SignerWithAddress

  opsSigner: SignerWithAddress
  gelato: SignerWithAddress
  opsGelatoSigner: SignerWithAddress

  usdc: IERC20
  weth: IERC20
  wbtc: IERC20

  defaultTreasuryFund: BigNumber
  defaultFund: BigNumber
  defaultDCA: BigNumber
  defaultFee: BigNumber
  defaultSlippage: BigNumber
  defaultGasPrice: BigNumberish
  defaultInterval: BigNumberish
  defaultGelatoFee: BigNumber
  wethSwapRoute: string[]
  btcSwapRoute: string[]

  involica: Involica
  resolver: InvolicaResolver
  oracle: Oracle
  fetcher: InvolicaFetcher
  ops: IOps
  uniRouter: Contract

  emptyBytes32: string
  aliceResolverHash: string

  snapshotId: string
}

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export const prepare = async (chainId: number): Promise<ThisObject> => {
  const thisObject = {} as unknown as ThisObject

  thisObject.chainId = chainId
  thisObject.signers = await ethers.getSigners()

  thisObject.deployer = thisObject.signers[0]
  thisObject.alice = thisObject.signers[1]
  thisObject.bob = thisObject.signers[2]

  // Impersonate ops for signing, add funds
  thisObject.opsSigner = await impersonateAndFund(OPS_ADDRESS[chainId])

  // Tokens
  thisObject.usdc = <IERC20>await ethers.getContractAt('IERC20', USDC_ADDRESS[chainId])
  thisObject.weth = <IERC20>await ethers.getContractAt('IERC20', WETH_ADDRESS[chainId])
  thisObject.wbtc = <IERC20>await ethers.getContractAt('IERC20', WBTC_ADDRESS[chainId])

  // Default Values
  thisObject.defaultTreasuryFund = parseEther('0.5')
  thisObject.defaultFund = parseUnits('10000', USDC_DECIMALS)
  thisObject.defaultDCA = thisObject.defaultFund.div(10)
  thisObject.defaultFee = thisObject.defaultDCA.mul(5).div(10000)
  thisObject.defaultInterval = 60 // second;
  thisObject.wethSwapRoute = [thisObject.usdc.address, thisObject.weth.address]
  thisObject.btcSwapRoute = [thisObject.usdc.address, thisObject.weth.address, thisObject.wbtc.address]
  thisObject.defaultGasPrice = 100
  thisObject.defaultGelatoFee = parseEther('0.05')

  // Fill Wallets
  await mintUsdc(chainId, thisObject.defaultFund.mul(10), thisObject.alice.address)
  await mintUsdc(chainId, thisObject.defaultFund.mul(10), thisObject.bob.address)

  // Contract:Involica
  const InvolicaFactory = (await ethers.getContractFactory('Involica', thisObject.deployer)) as Involica__factory
  thisObject.involica = await InvolicaFactory.deploy(
    thisObject.deployer.address,
    OPS_ADDRESS[chainId],
    ROUTER_ADDRESS[chainId],
    thisObject.weth.address,
  )
  await thisObject.involica.deployed()
  await thisObject.involica
    .connect(thisObject.deployer)
    .setAllowedTokens([thisObject.usdc.address, thisObject.wbtc.address], [true, true])
  thisObject.defaultSlippage = await thisObject.involica.minSlippage()
  // Fund involica so that it can cover funds if user cant
  await fund(thisObject.involica.address)

  // Contract:Resolver
  const InvolicaResolverFactory = (await ethers.getContractFactory(
    'InvolicaResolver',
    thisObject.deployer,
  )) as InvolicaResolver__factory
  thisObject.resolver = await InvolicaResolverFactory.deploy(thisObject.involica.address, ROUTER_ADDRESS[chainId])
  await thisObject.resolver.deployed()
  await thisObject.involica.connect(thisObject.deployer).setResolver(thisObject.resolver.address)

  // Contract:Oracle
  const OracleFactory = (await ethers.getContractFactory('Oracle', thisObject.deployer)) as Oracle__factory
  thisObject.oracle = await OracleFactory.deploy(
    ROUTER_ADDRESS[chainId],
    thisObject.weth.address,
    thisObject.usdc.address,
  )

  // Contract:Fetcher
  const InvolicaFetcherFactory = (await ethers.getContractFactory(
    'InvolicaFetcher',
    thisObject.deployer,
  )) as InvolicaFetcher__factory
  thisObject.fetcher = await InvolicaFetcherFactory.deploy(thisObject.involica.address, thisObject.oracle.address)
  await thisObject.fetcher.deployed()

  // Contract:Ops
  thisObject.ops = <IOps>await ethers.getContractAt('IOps', OPS_ADDRESS[chainId])
  thisObject.opsGelatoSigner = await impersonateAndFund(await thisObject.ops.gelato())

  // Contract:UniRouter
  thisObject.uniRouter = await ethers.getContractAt('IUniswapV2Router', ROUTER_ADDRESS[chainId])

  // Approve user funds
  await thisObject.usdc.connect(thisObject.alice).approve(thisObject.involica.address, ethers.constants.MaxUint256)
  await thisObject.usdc.connect(thisObject.bob).approve(thisObject.involica.address, ethers.constants.MaxUint256)

  // Alice Resolver Hash
  const getResolverHash = async (userAddress: string) => {
    const resolverData = thisObject.resolver.interface.encodeFunctionData('checkPositionExecutable', [userAddress])
    return await thisObject.ops.getResolverHash(thisObject.resolver.address, resolverData)
  }
  thisObject.aliceResolverHash = await getResolverHash(thisObject.alice.address)

  // Helper Vars
  thisObject.emptyBytes32 = ethers.utils.hexZeroPad(BigNumber.from(0).toHexString(), 32)

  // Take snapshot
  thisObject.snapshotId = await ethers.provider.send('evm_snapshot', [])

  return thisObject
}

export const setAllowedTokens = async (involica: Involica, tokens: string[], alloweds: boolean[]): Promise<void> => {
  await involica.setAllowedTokens(tokens, alloweds)
}
export const setAllowedToken = async (involica: Involica, token: string, allowed: boolean): Promise<void> => {
  await setAllowedTokens(involica, [token], [allowed])
}

export const setBlacklistedPairs = async (
  involica: Involica,
  pairs: string[][],
  blacklisteds: boolean[],
): Promise<void> => {
  await involica.setBlacklistedPairs(pairs.flat(), blacklisteds)
}
export const setBlacklistedPair = async (involica: Involica, pair: string[], blacklisted: boolean): Promise<void> => {
  await setBlacklistedPairs(involica, [pair], [blacklisted])
}

export const mintUsdc = async (chainId: number, amount: BigNumberish, to: string): Promise<void> => {
  const usdc = await ethers.getContractAt('IERC20', USDC_ADDRESS[chainId])

  await network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [USDC_OWNING_WALLET[chainId]],
  })

  const usdcWalletSigner = await ethers.getSigner(USDC_OWNING_WALLET[chainId])
  await usdc.connect(usdcWalletSigner).transfer(to, amount)
}

export const getCurrentTimestamp = async (): Promise<BigNumber> => {
  const block = await ethers.provider.getBlock('latest')
  return BigNumber.from(block.timestamp)
}

export const fastForwardTo = async (timestamp: number): Promise<void> => {
  await ethers.provider.send('evm_setNextBlockTimestamp', [timestamp])
  await ethers.provider.send('evm_mine', [])
}

export const impersonateAndFund = async (address: string): Promise<SignerWithAddress> => {
  await fund(address)
  return await impersonate(address)
}

export const impersonate = async (address: string): Promise<SignerWithAddress> => {
  await network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [address],
  })

  return ethers.getSigner(address)
}
export const fund = async (address: string): Promise<void> => {
  await network.provider.send('hardhat_setBalance', [address, parseEther('1')._hex.replace('0x0', '0x')])
}

export const ONE_ETH = parseEther('1')

export const parseGwei = (value: BigNumberish): BigNumber => BigNumber.from(value).mul(1000000000)
