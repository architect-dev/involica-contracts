import { ethers, network } from 'hardhat'
import { Involica, Involica__factory, IERC20 } from '../typechain'

import chai from 'chai'
import { solidity } from 'ethereum-waffle'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  ETH_TOKEN_ADDRESS,
  OPS_ADDRESS,
  ROUTER_ADDRESS,
  USDC_ADDRESS,
  USDC_DECIMALS,
  WBTC_ADDRESS,
  WETH_ADDRESS,
} from '../constants'
import { BigNumber, BigNumberish } from '@ethersproject/bignumber'
import { fastForwardTo, mintUsdc, parseGwei } from './utils'
import { parseEther, parseUnits } from '@ethersproject/units'

const { expect } = chai
chai.use(solidity)

describe('Involica FromWallet', function () {
  let deployer: SignerWithAddress
  let alice: SignerWithAddress
  let bob: SignerWithAddress

  let ops: SignerWithAddress

  let involica: Involica

  let usdc: IERC20
  let weth: IERC20
  let wbtc: IERC20

  let defaultTreasuryFund: BigNumber
  let defaultFund: BigNumber
  let defaultEtherFund: BigNumber
  let defaultDCA: BigNumber
  let defaultEtherDCA: BigNumber
  let defaultSlippage: BigNumber
  let defaultGasPrice: BigNumberish
  let defaultInterval: BigNumberish
  let usdcSwapRoute: string[]
  let wethSwapRoute: string[]
  let btcSwapRoute: string[]

  let emptyBytes32: string

  let snapshotId: string
  const chainId = 250

  before('setup contracts', async () => {
    ;[deployer, alice, bob] = await ethers.getSigners()

    usdc = <IERC20>await ethers.getContractAt('IERC20', USDC_ADDRESS[chainId])
    weth = <IERC20>await ethers.getContractAt('IERC20', WETH_ADDRESS[chainId])
    wbtc = <IERC20>await ethers.getContractAt('IERC20', WBTC_ADDRESS[chainId])

    defaultTreasuryFund = parseEther('0.5')
    defaultFund = parseUnits('10000', USDC_DECIMALS)
    defaultEtherFund = parseEther('1000')
    defaultDCA = defaultFund.div(10)
    defaultEtherDCA = defaultEtherFund.div(10)
    defaultInterval = 60 // second;
    usdcSwapRoute = [weth.address, usdc.address]
    wethSwapRoute = [usdc.address, weth.address]
    btcSwapRoute = [usdc.address, weth.address, wbtc.address]
    defaultGasPrice = 100

    emptyBytes32 = ethers.utils.hexZeroPad(BigNumber.from(0).toHexString(), 32)

    const InvolicaFactory = (await ethers.getContractFactory('Involica', deployer)) as Involica__factory

    involica = await InvolicaFactory.deploy(OPS_ADDRESS[chainId], ROUTER_ADDRESS[chainId], weth.address)
    await involica.deployed()
    defaultSlippage = await involica.minSlippage()

    await involica.connect(deployer).setAllowedTokens([usdc.address, wbtc.address], [true, true])

    await mintUsdc(chainId, defaultFund.mul(10), alice.address)
    await usdc.connect(alice).approve(involica.address, ethers.constants.MaxUint256)

    // Impersonate ops
    await network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [OPS_ADDRESS[chainId]],
    })

    ops = await ethers.getSigner(OPS_ADDRESS[chainId])

    // Fund ops
    await network.provider.send('hardhat_setBalance', [ops.address, parseEther('1')._hex.replace('0x0', '0x')])

    // Take snapshot
    snapshotId = await ethers.provider.send('evm_snapshot', [])
  })

  beforeEach(async () => {
    await ethers.provider.send('evm_revert', [snapshotId])
    snapshotId = await ethers.provider.send('evm_snapshot', [])
  })

  describe('setPosition()', async () => {
    beforeEach(async () => {
      await involica.connect(alice).depositTreasury({ value: defaultTreasuryFund })
    })
    it('should revert if allowance is 0', async function () {
      await usdc.connect(alice).approve(involica.address, 0)
      await expect(
        involica.connect(alice).setPosition(
          usdc.address,
          [
            {
              token: weth.address,
              weight: 10000,
              route: wethSwapRoute,
              maxSlippage: defaultSlippage,
            },
          ],
          defaultDCA,
          defaultInterval,
          defaultGasPrice,
        ),
      ).to.be.revertedWith('Approve for at least 1 DCA')
    })
    it('should revert if wallet balance is 0', async () => {
      const aliceUsdcBalance = await usdc.balanceOf(alice.address)
      await usdc.connect(alice).transfer(bob.address, aliceUsdcBalance)
      await expect(
        involica.connect(alice).setPosition(
          usdc.address,
          [
            {
              token: weth.address,
              weight: 10000,
              route: wethSwapRoute,
              maxSlippage: defaultSlippage,
            },
          ],
          defaultDCA,
          defaultInterval,
          defaultGasPrice,
        ),
      ).to.be.revertedWith('Wallet balance for at least 1 DCA')
    })

    it('should allow in funds to be 0', async () => {
      const tx = await involica.connect(alice).setPosition(
        usdc.address,
        [
          {
            token: weth.address,
            weight: 10000,
            route: wethSwapRoute,
            maxSlippage: defaultSlippage,
          },
        ],
        defaultDCA,
        defaultInterval,
        defaultGasPrice,
      )

      expect(tx).to.changeEtherBalance(alice, 0)
      expect(tx).to.emit(involica, 'SetPosition')
    })
    it('should create position and not deposit funds', async () => {
      const aliceUsdcBefore = await usdc.balanceOf(alice.address)
      const tx = await involica.connect(alice).setPosition(
        usdc.address,
        [
          {
            token: weth.address,
            weight: 10000,
            route: wethSwapRoute,
            maxSlippage: defaultSlippage,
          },
        ],
        defaultDCA,
        defaultInterval,
        defaultGasPrice,
      )

      expect(tx).to.changeEtherBalance(alice, 0)
      expect(tx).to.emit(involica, 'SetPosition')

      const aliceUsdcAfter = await usdc.balanceOf(alice.address)

      expect(aliceUsdcBefore).to.equal(aliceUsdcAfter)

      const position = (await involica.fetchUserData(alice.address)).position
      expect(position.user).to.be.eq(alice.address)
      expect(position.tokenIn).to.be.eq(usdc.address)
      expect(position.outs.length).to.be.eq(1)
      expect(position.outs[0].token).to.be.eq(weth.address)
      expect(position.outs[0].weight).to.be.eq(10000)
      expect(position.outs[0].maxSlippage).to.be.eq(defaultSlippage)
      expect(position.outs[0].balance).to.be.eq(0)
      expect(position.balanceIn).to.be.eq(0)
      expect(position.amountDCA).to.be.eq(defaultDCA)
      expect(position.intervalDCA).to.be.eq(defaultInterval)
      expect(position.maxGasPrice).to.be.eq(parseGwei(defaultGasPrice))
      expect(position.lastDCA).to.be.eq(0)
      expect(position.taskId).to.exist
      expect(position.finalizationReason).to.equal('')
    })
  })

  describe('exitPosition()', async () => {
    beforeEach(async () => {
      await involica.connect(alice).depositTreasury({ value: defaultTreasuryFund })
      await involica.connect(bob).depositTreasury({ value: defaultTreasuryFund })

      await involica.connect(alice).setPosition(
        usdc.address,
        [
          {
            token: weth.address,
            weight: 5000,
            route: wethSwapRoute,
            maxSlippage: defaultSlippage,
          },
          {
            token: wbtc.address,
            weight: 5000,
            route: btcSwapRoute,
            maxSlippage: defaultSlippage,
          },
        ],
        defaultDCA,
        defaultInterval,
        defaultGasPrice,
      )
    })

    it('exiting a fromWallet position should return only treasury funds', async function () {
      const aliceUsdcBefore = await usdc.balanceOf(alice.address)
      const involicaWethBefore = await weth.balanceOf(involica.address)

      const tx = await involica.connect(alice).exitPosition()
      expect(tx).to.emit(involica, 'ExitPosition')
      expect(tx).to.changeEtherBalance(involica, defaultTreasuryFund.mul(-1))
      expect(tx).to.changeEtherBalance(alice, defaultTreasuryFund)

      const aliceUsdcAfter = await usdc.balanceOf(alice.address)
      const involicaWethAfter = await weth.balanceOf(involica.address)

      expect(aliceUsdcBefore).to.be.eq(aliceUsdcAfter)
      expect(involicaWethBefore).to.be.eq(involicaWethAfter)
    })
  })

  describe('executeDCA()', async () => {
    beforeEach(async () => {
      await involica.connect(alice).depositTreasury({ value: defaultTreasuryFund })

      await involica.connect(alice).setPosition(
        usdc.address,
        [
          {
            token: weth.address,
            weight: 10000,
            route: wethSwapRoute,
            maxSlippage: defaultSlippage,
          },
        ],
        defaultDCA,
        defaultInterval,
        defaultGasPrice,
      )
    })

    it('should finalize if approved amount is 0')
    it('should finalize if wallet balance amount is 0')
    it('should withdraw in from wallet and send outs to wallet during execute')
    it('approved amount should decrease')
    // it('should finalize if position has run out of funds', async () => {
    // 	await involica.connect(alice).withdrawIn(defaultFund.sub(defaultDCA).sub(1))
    // 	await involica.connect(ops).executeDCA(alice.address, [0])

    // 	const lastDCA = (await involica.fetchUserData(alice.address)).position.lastDCA
    // 	await fastForwardTo(Number(lastDCA.add(defaultInterval)))

    // 	const tx = await involica.connect(ops).executeDCA(alice.address, [0])

    // 	expect(tx).to.emit(involica, 'FinalizeTask').withArgs(alice.address, 'Insufficient funds')

    // 	const { finalizationReason, taskId } = (await involica.fetchUserData(alice.address)).position
    // 	expect(finalizationReason).to.be.eq('Insufficient funds')
    // 	expect(taskId).to.be.eq(emptyBytes32)
    // })
    it('approved should still decrease even if swap fails', async () => {
      await involica.connect(ops).executeDCA(alice.address, [parseEther('10000000000000')])
      const position = (await involica.fetchUserData(alice.address)).position
      expect(position.outs[0].balance).to.eq(0)
    })
    it('balanceIn should be 0 after swap', async () => {
      const aliceBalanceInBefore = (await involica.fetchUserData(alice.address)).position.balanceIn

      await involica.connect(ops).executeDCA(alice.address, [parseEther('10000000000000')])

      const position = (await involica.fetchUserData(alice.address)).position
      const aliceBalanceInAfter = (await involica.fetchUserData(alice.address)).position.balanceIn
      expect(aliceBalanceInBefore).to.be.eq(aliceBalanceInAfter)
      expect(position.outs[0].balance).to.eq(0)
    })
    it('balanceIn should be 0 even if swap fails', async () => {
      const aliceBalanceInBefore = (await involica.fetchUserData(alice.address)).position.balanceIn

      await involica.connect(ops).executeDCA(alice.address, [parseEther('10000000000000')])

      const position = (await involica.fetchUserData(alice.address)).position
      const aliceBalanceInAfter = (await involica.fetchUserData(alice.address)).position.balanceIn
      expect(aliceBalanceInBefore).to.be.eq(aliceBalanceInAfter)
      expect(position.outs[0].balance).to.eq(0)
    })
    it('should execute DCA', async () => {
      const dcaAmount = (await involica.fetchUserData(alice.address)).position.amountDCA

      const balanceFundBefore = await usdc.balanceOf(involica.address)
      const balanceAssetBefore = await weth.balanceOf(involica.address)

      const uniRouter = await ethers.getContractAt('IUniswapV2Router', ROUTER_ADDRESS[chainId])
      const swapAmounts1 = await uniRouter.getAmountsOut(dcaAmount, [usdc.address, weth.address])

      await expect(involica.connect(ops).executeDCA(alice.address, [0]))
        .to.emit(involica, 'ExecuteDCA')
        .withArgs(alice.address)

      const balanceFundAfter = await usdc.balanceOf(involica.address)
      const balanceAssetAfter = await weth.balanceOf(involica.address)

      expect(balanceFundBefore.sub(balanceFundAfter)).to.be.eq(defaultDCA)

      const wethDifference1 = balanceAssetAfter.sub(balanceAssetBefore)
      expect(wethDifference1).to.be.gte(swapAmounts1[1])

      const positionAfter = (await involica.fetchUserData(alice.address)).position
      expect(positionAfter.balanceIn).to.be.eq(defaultFund.sub(defaultDCA))
      expect(positionAfter.outs[0].balance).to.be.eq(wethDifference1)

      const lastDCA = positionAfter.lastDCA
      const nextDCA = lastDCA.add(positionAfter.intervalDCA)

      await fastForwardTo(nextDCA.toNumber())

      const swapAmounts2 = await uniRouter.getAmountsOut(dcaAmount, [usdc.address, weth.address])
      await expect(involica.connect(ops).executeDCA(alice.address, [0])).to.emit(involica, 'FinalizeDCA')

      const balanceFundFinal = await usdc.balanceOf(involica.address)
      const balanceAssetFinal = await weth.balanceOf(involica.address)

      expect(balanceFundAfter.sub(balanceFundFinal)).to.be.eq(defaultDCA)

      const wethDifference2 = balanceAssetFinal.sub(balanceAssetAfter)
      expect(wethDifference2).to.be.gte(swapAmounts2[1])

      const positionFinal = (await involica.fetchUserData(alice.address)).position
      expect(positionFinal.balanceIn).to.be.eq(defaultFund.sub(defaultDCA).sub(defaultDCA))
      expect(positionFinal.outs[0].balance.sub(positionAfter.outs[0].balance)).to.be.eq(wethDifference2)

      // TX WITH FAILING TOKEN SWAP
      const finalDCA = nextDCA.add(1).add(positionAfter.intervalDCA)
      await fastForwardTo(finalDCA.toNumber())
      await involica.connect(ops).executeDCA(alice.address, [parseEther('10000000000000')])

      // TEST TX RECEIPTS
      const txs = (await involica.fetchUserData(alice.address)).txs
      expect(txs.length).to.eq(3)

      expect(txs[0].timestamp).to.eq(lastDCA)
      expect(txs[0].tokenTxs.length).to.eq(1)
      expect(txs[0].tokenTxs[0].tokenIn).to.eq(usdc.address)
      expect(txs[0].tokenTxs[0].tokenOut).to.eq(weth.address)
      expect(txs[0].tokenTxs[0].amountIn).to.eq(dcaAmount)
      expect(txs[0].tokenTxs[0].amountOut).to.eq(wethDifference1)
      expect(txs[0].tokenTxs[0].err).to.eq('')

      expect(txs[1].timestamp).to.eq(nextDCA.add(1))
      expect(txs[1].tokenTxs.length).to.eq(1)
      expect(txs[1].tokenTxs[0].tokenIn).to.eq(usdc.address)
      expect(txs[1].tokenTxs[0].tokenOut).to.eq(weth.address)
      expect(txs[1].tokenTxs[0].amountIn).to.eq(dcaAmount)
      expect(txs[1].tokenTxs[0].amountOut).to.eq(wethDifference2)
      expect(txs[1].tokenTxs[0].err).to.eq('')

      expect(txs[2].timestamp).to.eq(finalDCA.add(1))
      expect(txs[2].tokenTxs.length).to.eq(1)
      expect(txs[2].tokenTxs[0].tokenIn).to.eq(usdc.address)
      expect(txs[2].tokenTxs[0].tokenOut).to.eq(weth.address)
      expect(txs[2].tokenTxs[0].amountIn).to.eq(0)
      expect(txs[2].tokenTxs[0].amountOut).to.eq(0)
      expect(txs[2].tokenTxs[0].err).to.eq('UniswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT')
    })
    it('Should return unused in token if swaps partially fail', async function () {
      await involica.connect(alice).setPosition(
        usdc.address,
        [
          {
            token: weth.address,
            weight: 2000,
            route: wethSwapRoute,
            maxSlippage: defaultSlippage,
          },
          {
            token: wbtc.address,
            weight: 8000,
            route: btcSwapRoute,
            maxSlippage: defaultSlippage,
          },
        ],
        defaultDCA,
        defaultInterval,
        defaultGasPrice,
      )

      const { balanceIn: balanceInBefore } = (await involica.fetchUserData(alice.address)).position

      await involica.connect(ops).executeDCA(alice.address, [0, parseEther('10000000000000')])

      const { lastDCA, outs, balanceIn: balanceInAfter } = (await involica.fetchUserData(alice.address)).position
      const wethBalance = outs[0].balance

      // Partial DCA amount used
      expect(balanceInBefore.sub(balanceInAfter)).to.eq(defaultDCA.mul(2000).div(10000))

      // TEST TX RECEIPTS
      const txs = (await involica.fetchUserData(alice.address)).txs
      expect(txs.length).to.eq(1)

      expect(txs[0].timestamp).to.eq(lastDCA)
      expect(txs[0].tokenTxs.length).to.eq(2)

      expect(txs[0].tokenTxs[0].tokenIn).to.eq(usdc.address)
      expect(txs[0].tokenTxs[0].tokenOut).to.eq(weth.address)
      expect(txs[0].tokenTxs[0].amountIn).to.eq(defaultDCA.mul(2000).div(10000))
      expect(txs[0].tokenTxs[0].amountOut).to.eq(wethBalance)
      expect(txs[0].tokenTxs[0].err).to.eq('')

      expect(txs[0].tokenTxs[1].tokenIn).to.eq(usdc.address)
      expect(txs[0].tokenTxs[1].tokenOut).to.eq(wbtc.address)
      expect(txs[0].tokenTxs[1].amountIn).to.eq(0)
      expect(txs[0].tokenTxs[1].amountOut).to.eq(0)
      expect(txs[0].tokenTxs[1].err).to.eq('UniswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT')
    })
  })
})
