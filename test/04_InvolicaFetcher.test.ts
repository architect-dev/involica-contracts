import { ethers } from 'hardhat'
import { IERC20, InvolicaFetcher } from '../typechain'
import chai from 'chai'
import { solidity } from 'ethereum-waffle'
import { prepare } from './utils'

const { expect } = chai
chai.use(solidity)
const routify = (route: string[]) => route.join(' -> ')
const expectRoutesMatch = (a: string[], b: string[]) => expect(routify(a)).to.eq(routify(b))

describe('Involica Fetcher', function () {
  // let chainId: number
  // let signers: SignerWithAddress[]

  // let deployer: SignerWithAddress
  // let alice: SignerWithAddress
  // let bob: SignerWithAddress

  // let opsSigner: SignerWithAddress
  // let gelato: SignerWithAddress
  // let opsGelatoSigner: SignerWithAddress

  let usdc: IERC20
  let weth: IERC20
  let wbtc: IERC20

  // let defaultTreasuryFund: BigNumber
  // let defaultFund: BigNumber
  // let defaultDCA: BigNumber
  // let defaultFee: BigNumber
  // let defaultSlippage: BigNumber
  // let defaultGasPrice: BigNumberish
  // let defaultInterval: BigNumberish
  // let defaultGelatoFee: BigNumber
  // let wethSwapRoute: string[]
  let btcSwapRoute: string[]

  // let involica: Involica
  // let resolver: InvolicaResolver
  // let oracle: Oracle
  let fetcher: InvolicaFetcher
  // let ops: IOps
  // let uniRouter: Contract

  // let emptyBytes32: string
  // let aliceResolverHash: string

  let snapshotId: string

  before('setup contracts', async () => {
    ;({
      // chainId,
      // signers,
      // deployer,
      // alice,
      // bob,
      // opsSigner,
      // gelato,
      // opsGelatoSigner,
      usdc,
      weth,
      wbtc,
      // defaultTreasuryFund,
      // defaultFund,
      // defaultDCA,
      // defaultFee,
      // defaultSlippage,
      // defaultGasPrice,
      // defaultInterval,
      // defaultGelatoFee,
      // wethSwapRoute,
      btcSwapRoute,
      // involica,
      // resolver,
      // oracle,
      fetcher,
      // ops,
      // uniRouter,
      // emptyBytes32,
      // aliceResolverHash,
      snapshotId,
    } = await prepare(250))
  })

  beforeEach(async () => {
    await ethers.provider.send('evm_revert', [snapshotId])
    snapshotId = await ethers.provider.send('evm_snapshot', [])
  })

  describe('fetchTokensData()', async () => {
    it('Fetching should not fail if zeroAddress passed in', async () => {
      await fetcher.fetchUserData(ethers.constants.AddressZero)
    })
    it('Fetched prices should be correct', async () => {
      const { tokens, decimals, prices } = await fetcher.fetchTokensData()

      // const tokensAndPrices = zip(
      //   ['wFTM', 'USDC', 'wBTC'],
      //   tokens,
      //   prices.map((price) => ethers.utils.formatUnits(price, 6)),
      // )

      // console.log({
      //   tokensAndPrices,
      // })

      expect(tokens[0]).to.eq(weth.address)
      expect(tokens[1]).to.eq(usdc.address)
      expect(tokens[2]).to.eq(wbtc.address)

      expect(decimals[0]).to.eq(18)
      expect(decimals[1]).to.eq(6)
      expect(decimals[2]).to.eq(8)

      expect(prices[0]).to.be.lt(prices[1])
      expect(prices[1]).to.eq(1000000)
      expect(prices[2]).to.be.gt(prices[1])
    })
  })
  it('Fetching routes succeeds', async () => {
    const route = await fetcher.fetchPairRoute(usdc.address, wbtc.address)

    // console.log({
    //   route: routify(route),
    // })

    expectRoutesMatch(route, btcSwapRoute)
  })
})
