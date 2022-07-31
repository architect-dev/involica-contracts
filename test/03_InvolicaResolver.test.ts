import { ethers, network } from 'hardhat'
import { Involica, InvolicaResolver, InvolicaResolver__factory, Involica__factory, IERC20 } from '../typechain'

import chai from 'chai'
import { solidity } from 'ethereum-waffle'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { OPS_ADDRESS, ROUTER_ADDRESS, USDC_ADDRESS, USDC_DECIMALS, WBTC_ADDRESS, WETH_ADDRESS } from '../constants'
import { BigNumber, BigNumberish } from '@ethersproject/bignumber'
import { mintUsdc, parseGwei } from './utils'
import { parseUnits } from '@ethersproject/units'
import { Contract } from 'ethers/lib/ethers'
import { parseEther, toUtf8String } from 'ethers/lib/utils'

const { expect } = chai
chai.use(solidity)

describe('Involica Resolver', function () {
  let deployer: SignerWithAddress
  let alice: SignerWithAddress
  let bob: SignerWithAddress

  let ops: SignerWithAddress

  let involica: Involica
  let resolver: InvolicaResolver
  let uniRouter: Contract

  let usdc: IERC20
  let weth: IERC20
  let wbtc: IERC20

  let defaultTreasuryFund: BigNumber
  let defaultFund: BigNumber
  let defaultDCA: BigNumber
  let defaultInterval: BigNumberish
  let defaultGasPrice: BigNumberish
  let defaultSlippage: BigNumber
  let wethSwapRoute: string[]
  let wbtcSwapRoute: string[]

  let snapshotId: string
  const chainId = 250

  before('setup contracts', async () => {
    ;[deployer, alice, bob] = await ethers.getSigners()

    usdc = <IERC20>await ethers.getContractAt('IERC20', USDC_ADDRESS[chainId])
    weth = <IERC20>await ethers.getContractAt('IERC20', WETH_ADDRESS[chainId])
    wbtc = <IERC20>await ethers.getContractAt('IERC20', WBTC_ADDRESS[chainId])

    defaultTreasuryFund = parseEther('0.5')
    defaultFund = parseUnits('10000', USDC_DECIMALS)
    defaultDCA = defaultFund.div(10)
    defaultInterval = 60 // second;
    wethSwapRoute = [usdc.address, weth.address]
    wbtcSwapRoute = [usdc.address, weth.address, wbtc.address]
    defaultGasPrice = 100

    const InvolicaFactory = (await ethers.getContractFactory('Involica', deployer)) as Involica__factory
    involica = await InvolicaFactory.deploy(OPS_ADDRESS[chainId], ROUTER_ADDRESS[chainId], weth.address)
    await involica.deployed()
    defaultSlippage = await involica.minSlippage()

    const InvolicaResolverFactory = (await ethers.getContractFactory(
      'InvolicaResolver',
      deployer,
    )) as InvolicaResolver__factory
    resolver = await InvolicaResolverFactory.deploy(involica.address, ROUTER_ADDRESS[chainId])
    await resolver.deployed()

    await involica.connect(deployer).setResolver(resolver.address)

    uniRouter = await ethers.getContractAt('IUniswapV2Router', ROUTER_ADDRESS[chainId])

    await involica.connect(deployer).setAllowedTokens([usdc.address, wbtc.address], [true, true])

    await mintUsdc(chainId, defaultFund.mul(10), alice.address)
    await mintUsdc(chainId, defaultFund.mul(10), bob.address)

    await usdc.connect(alice).approve(involica.address, ethers.constants.MaxUint256)
    await usdc.connect(bob).approve(involica.address, ethers.constants.MaxUint256)

    // Impersonate ops
    await network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [OPS_ADDRESS[chainId]],
    })

    ops = await ethers.getSigner(OPS_ADDRESS[chainId])

    // Fund ops
    await network.provider.send('hardhat_setBalance', [ops.address, parseEther('1')._hex.replace('0x0', '0x')])

    snapshotId = await ethers.provider.send('evm_snapshot', [])
  })

  beforeEach(async () => {
    await ethers.provider.send('evm_revert', [snapshotId])
    snapshotId = await ethers.provider.send('evm_snapshot', [])
  })

  describe('checkPositionExecutable()', async () => {
    beforeEach(async () => {
      await involica.connect(alice).depositTreasury({ value: defaultTreasuryFund })
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
            route: wbtcSwapRoute,
            maxSlippage: defaultSlippage,
          },
        ],
        defaultDCA,
        defaultInterval,
        defaultGasPrice,
      )
    })
    it('should return false if user doesnt have position', async () => {
      await involica.connect(alice).exitPosition()

      const [canExec, payload] = await resolver.checkPositionExecutable(alice.address)
      expect(canExec).to.be.eq(false)

      expect(toUtf8String(payload)).to.be.eq('User doesnt have a position')
    })
    it('should return false if user position not mature', async () => {
      await involica.connect(ops).executeDCA(alice.address, [0, 0])

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

      const wethAmounts = await uniRouter.getAmountsOut(defaultDCA.mul(5000).div(10000), wethSwapRoute)
      const wbtcAmounts = await uniRouter.getAmountsOut(defaultDCA.mul(5000).div(10000), wbtcSwapRoute)

      const wethAmountOutMin: BigNumber = wethAmounts[wethAmounts.length - 1]
        .mul(BigNumber.from(10000).sub(defaultSlippage))
        .div(10000)
      const wbtcAmountOutMin: BigNumber = wbtcAmounts[wbtcAmounts.length - 1]
        .mul(BigNumber.from(10000).sub(defaultSlippage))
        .div(10000)

      const taskData = involica.interface.encodeFunctionData('executeDCA', [
        alice.address,
        [wethAmountOutMin, wbtcAmountOutMin],
      ])

      expect(payload).to.be.eq(taskData)
    })
    it('executeDCA should succeed with swapsAmountOutMins', async () => {
      const [canExec, payload] = await resolver.checkPositionExecutable(alice.address)
      expect(canExec).to.be.eq(true)

      const wethAmounts = await uniRouter.getAmountsOut(defaultDCA.mul(5000).div(10000), wethSwapRoute)
      const wbtcAmounts = await uniRouter.getAmountsOut(defaultDCA.mul(5000).div(10000), wbtcSwapRoute)

      const wethAmountOutMin: BigNumber = wethAmounts[wethAmounts.length - 1]
        .mul(BigNumber.from(10000).sub(defaultSlippage))
        .div(10000)
      const wbtcAmountOutMin: BigNumber = wbtcAmounts[wbtcAmounts.length - 1]
        .mul(BigNumber.from(10000).sub(defaultSlippage))
        .div(10000)

      const taskData = involica.interface.encodeFunctionData('executeDCA', [
        alice.address,
        [wethAmountOutMin, wbtcAmountOutMin],
      ])

      expect(payload).to.be.eq(taskData)

      const tx = await ops.sendTransaction({
        to: involica.address,
        data: taskData,
      })

      expect(tx).to.emit(involica, 'FinalizeDCA')
    })
  })
})
