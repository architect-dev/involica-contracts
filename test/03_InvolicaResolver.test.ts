import { ethers } from 'hardhat'
import { Involica, InvolicaResolver, IERC20, Oracle } from '../typechain'
import chai from 'chai'
import { solidity } from 'ethereum-waffle'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { BigNumber, BigNumberish } from '@ethersproject/bignumber'
import { parseGwei, prepare } from './utils'
import { Contract } from 'ethers/lib/ethers'
import { toUtf8String } from 'ethers/lib/utils'

const { expect } = chai
chai.use(solidity)

describe('Involica Resolver', function () {
  // let chainId: number
  // let signers: SignerWithAddress[]

  // let deployer: SignerWithAddress
  let alice: SignerWithAddress
  // let bob: SignerWithAddress

  let opsSigner: SignerWithAddress
  // let gelato: SignerWithAddress
  // let opsGelatoSigner: SignerWithAddress

  let usdc: IERC20
  let weth: IERC20
  let wbtc: IERC20

  let defaultTreasuryFund: BigNumber
  // let defaultFund: BigNumber
  let defaultDCA: BigNumber
  // let defaultFee: BigNumber
  let defaultSlippage: BigNumber
  let defaultGasPrice: BigNumberish
  let defaultInterval: BigNumberish
  // let defaultGelatoFee: BigNumber
  let wethSwapRoute: string[]
  let btcSwapRoute: string[]

  let involica: Involica
  let resolver: InvolicaResolver
  let oracle: Oracle
  // let fetcher: InvolicaFetcher
  // let ops: IOps
  let uniRouter: Contract

  // let emptyBytes32: string
  // let aliceResolverHash: string

  let snapshotId: string

  before('setup contracts', async () => {
    ;({
      // chainId,
      // signers,
      // deployer,
      alice,
      // bob,
      opsSigner,
      // gelato,
      // opsGelatoSigner,
      usdc,
      weth,
      wbtc,
      defaultTreasuryFund,
      // defaultFund,
      defaultDCA,
      // defaultFee,
      defaultSlippage,
      defaultGasPrice,
      defaultInterval,
      // defaultGelatoFee,
      wethSwapRoute,
      btcSwapRoute,
      involica,
      resolver,
      oracle,
      // fetcher,
      // ops,
      uniRouter,
      // emptyBytes32,
      // aliceResolverHash,
      snapshotId,
    } = await prepare(250))
  })

  beforeEach(async () => {
    await ethers.provider.send('evm_revert', [snapshotId])
    snapshotId = await ethers.provider.send('evm_snapshot', [])
  })

  describe('checkPositionExecutable()', async () => {
    beforeEach(async () => {
      await involica.connect(alice).depositTreasury({ value: defaultTreasuryFund })
      await involica.connect(alice).setPosition(
        alice.address,
        usdc.address,
        [
          {
            token: weth.address,
            weight: 5000,
            maxSlippage: defaultSlippage,
          },
          {
            token: wbtc.address,
            weight: 5000,
            maxSlippage: defaultSlippage,
          },
        ],
        defaultDCA,
        defaultInterval,
        defaultGasPrice,
        true,
        false,
      )
    })
    it('should return false if user doesnt have position', async () => {
      await involica.connect(alice).exitPosition()

      const [canExec, payload] = await resolver.checkPositionExecutable(alice.address)
      expect(canExec).to.be.eq(false)

      expect(toUtf8String(payload)).to.be.eq('User doesnt have a position')
    })
    it('should return false if user position not mature', async () => {
      await involica.connect(opsSigner).executeDCA(alice.address, 1e6, [wethSwapRoute, btcSwapRoute], [0, 0], [0, 0])

      const [canExec, payload] = await resolver.checkPositionExecutable(alice.address)
      expect(canExec).to.be.eq(false)

      expect(toUtf8String(payload)).to.be.eq('DCA not mature')
    })
    it('should return false if gas price is too expensive', async () => {
      const [canExec, payload] = await resolver.checkPositionExecutable(alice.address, {
        gasPrice: parseGwei(defaultGasPrice).mul(2),
      })
      expect(canExec).to.be.eq(false)

      expect(toUtf8String(payload)).to.be.eq('Gas too expensive')
    })
    it('should return true if position is ready', async () => {
      const [canExec] = await resolver.checkPositionExecutable(alice.address)
      expect(canExec).to.be.eq(true)
    })
    it('should return correct swapsAmountOutMins', async () => {
      const [canExec, payload] = await resolver.checkPositionExecutable(alice.address)
      expect(canExec).to.be.eq(true)

      const wethPrice = (await oracle.getPriceUsdc(weth.address)).price
      const wbtcPrice = (await oracle.getPriceUsdc(wbtc.address)).price

      const wethAmounts = await uniRouter.getAmountsOut(
        defaultDCA.mul(5000).mul(9990).div(10000).div(10000),
        wethSwapRoute,
      )
      const wbtcAmounts = await uniRouter.getAmountsOut(
        defaultDCA.mul(5000).mul(9990).div(10000).div(10000),
        btcSwapRoute,
      )

      const wethAmountOutMin: BigNumber = wethAmounts[wethAmounts.length - 1]
        .mul(BigNumber.from(10000).sub(defaultSlippage))
        .div(10000)
      const wbtcAmountOutMin: BigNumber = wbtcAmounts[wbtcAmounts.length - 1]
        .mul(BigNumber.from(10000).sub(defaultSlippage))
        .div(10000)

      const taskData = involica.interface.encodeFunctionData('executeDCA', [
        alice.address,
        1e6,
        [wethSwapRoute, btcSwapRoute],
        [wethAmountOutMin, wbtcAmountOutMin],
        [wethPrice, wbtcPrice],
      ])

      expect(payload).to.be.eq(taskData)
    })
    it('executeDCA should succeed with swapsAmountOutMins', async () => {
      const [canExec, payload] = await resolver.checkPositionExecutable(alice.address)
      expect(canExec).to.be.eq(true)

      const wethPrice = (await oracle.getPriceUsdc(weth.address)).price
      const wbtcPrice = (await oracle.getPriceUsdc(wbtc.address)).price

      const wethAmounts = await uniRouter.getAmountsOut(
        defaultDCA.mul(5000).mul(9990).div(10000).div(10000),
        wethSwapRoute,
      )
      const wbtcAmounts = await uniRouter.getAmountsOut(
        defaultDCA.mul(5000).mul(9990).div(10000).div(10000),
        btcSwapRoute,
      )

      const wethAmountOutMin: BigNumber = wethAmounts[wethAmounts.length - 1]
        .mul(BigNumber.from(10000).sub(defaultSlippage))
        .div(10000)
      const wbtcAmountOutMin: BigNumber = wbtcAmounts[wbtcAmounts.length - 1]
        .mul(BigNumber.from(10000).sub(defaultSlippage))
        .div(10000)

      const taskData = involica.interface.encodeFunctionData('executeDCA', [
        alice.address,
        1e6,
        [wethSwapRoute, btcSwapRoute],
        [wethAmountOutMin, wbtcAmountOutMin],
        [wethPrice, wbtcPrice],
      ])

      expect(payload).to.be.eq(taskData)

      const tx = await opsSigner.sendTransaction({
        to: involica.address,
        data: taskData,
      })

      expect(tx).to.emit(involica, 'FinalizeDCA')
    })
  })
})
