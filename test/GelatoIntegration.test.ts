import { ethers, network } from 'hardhat'
import { Involica, InvolicaResolver, InvolicaResolver__factory, Involica__factory, IERC20, IOps } from '../typechain'

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
import { fastForwardTo, getCurrentTimestamp, mintUsdc } from './utils'
import { parseEther, parseUnits } from '@ethersproject/units'

const { expect } = chai
chai.use(solidity)

describe('Integration Test: Gelato DCA', function () {
  let deployer: SignerWithAddress
  let alice: SignerWithAddress
  let bob: SignerWithAddress

  let involica: Involica
  let resolver: InvolicaResolver
  let opsContract: IOps
  let gelato: SignerWithAddress

  let usdc: IERC20
  let weth: IERC20
  let wbtc: IERC20

  let defaultTreasuryFund: BigNumber
  let defaultFund: BigNumber
  let defaultDCA: BigNumber
  let defaultSlippage: BigNumber
  let defaultInterval: BigNumberish
  let defaultGasPrice: BigNumberish
  let defaultGelatoFee: BigNumber
  let wethSwapRoute: string[]

  let emptyBytes32: string

  let aliceResolverHash: string

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
    defaultGasPrice = 100
    defaultGelatoFee = parseEther('0.05')

    emptyBytes32 = ethers.utils.hexZeroPad(BigNumber.from(0).toHexString(), 32)

    // PORTFOLIO DCA
    const InvolicaFactory = (await ethers.getContractFactory('Involica', deployer)) as Involica__factory

    involica = await InvolicaFactory.deploy(OPS_ADDRESS[chainId], ROUTER_ADDRESS[chainId], weth.address)
    await involica.deployed()
    defaultSlippage = await involica.minSlippage()

    await involica.connect(deployer).setAllowedTokens([usdc.address, wbtc.address], [true, true])

    // ADD GAS MONEY TO INVOLICA CONTRACT TO COVER FINALIZATION TX FEES IF USER CANT
    await network.provider.send('hardhat_setBalance', [involica.address, parseEther('1')._hex.replace('0x0', '0x')])

    // PORTFOLIO DCA RESOLVER
    const InvolicaResolverFactory = (await ethers.getContractFactory(
      'InvolicaResolver',
      deployer,
    )) as InvolicaResolver__factory
    resolver = await InvolicaResolverFactory.deploy(involica.address, ROUTER_ADDRESS[chainId])
    await resolver.deployed()

    await involica.connect(deployer).setResolver(resolver.address)

    await mintUsdc(chainId, defaultFund.mul(100), alice.address)
    await mintUsdc(chainId, defaultFund.mul(100), bob.address)

    await usdc.connect(alice).approve(involica.address, ethers.constants.MaxUint256)
    await usdc.connect(bob).approve(involica.address, ethers.constants.MaxUint256)

    // OPS CONTRACT
    opsContract = <IOps>await ethers.getContractAt('IOps', OPS_ADDRESS[chainId])

    const getResolverHash = async (userAddress: string) => {
      const resolverData = resolver.interface.encodeFunctionData('checkPositionExecutable', [userAddress])
      return await opsContract.getResolverHash(resolver.address, resolverData)
    }
    aliceResolverHash = await getResolverHash(alice.address)

    // IMPERSONATE GELATO
    const gelatoAddress = await opsContract.gelato()

    await network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [gelatoAddress],
    })

    gelato = await ethers.getSigner(gelatoAddress)

    await network.provider.send('hardhat_setBalance', [gelato.address, parseEther('1')._hex.replace('0x0', '0x')])

    // TAKE SNAPSHOT
    snapshotId = await ethers.provider.send('evm_snapshot', [])
  })

  beforeEach(async () => {
    await ethers.provider.send('evm_revert', [snapshotId])
    snapshotId = await ethers.provider.send('evm_snapshot', [])
  })

  describe('Gelato DCA fromWallet', async () => {
    it('should DCA until approval runs out, then finalize with "Insufficient approval to pull from wallet"', async () => {
      await usdc.connect(alice).approve(involica.address, defaultFund)
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

      const involicaUsdcBefore = await usdc.balanceOf(involica.address)
      const involicaWethBefore = await weth.balanceOf(involica.address)
      const aliceUsdcApprovalBefore = await usdc.allowance(alice.address, involica.address)
      const aliceWethBefore = await weth.balanceOf(alice.address)

      let finalizationReason = ''
      let iteration = 0
      while (iteration < 15 && finalizationReason !== 'Insufficient approval to pull from wallet') {
        const [canExec, payload] = await resolver.checkPositionExecutable(alice.address)
        expect(canExec).to.be.eq(true)

        await opsContract
          .connect(gelato)
          .exec(
            defaultGelatoFee.div(2),
            ETH_TOKEN_ADDRESS,
            involica.address,
            false,
            true,
            aliceResolverHash,
            involica.address,
            payload,
          )

        const now = await getCurrentTimestamp()
        await fastForwardTo(now.add(defaultInterval).toNumber())

        const position = (await involica.fetchUserData(alice.address)).position
        finalizationReason = position.finalizationReason
        iteration++
      }

      const position = (await involica.fetchUserData(alice.address)).position
      expect(position.finalizationReason).to.be.eq('Insufficient approval to pull from wallet')
      expect(position.taskId).to.be.eq(emptyBytes32)

      const involicaUsdcAfter = await usdc.balanceOf(involica.address)
      const involicaWethAfter = await weth.balanceOf(involica.address)
      const aliceUsdcApprovalAfter = await usdc.allowance(alice.address, involica.address)
      const aliceWethAfter = await weth.balanceOf(alice.address)

      // Involica contract should never have erc20s
      expect(involicaUsdcBefore).to.be.eq(0)
      expect(involicaUsdcAfter).to.be.eq(0)
      expect(involicaWethBefore).to.be.eq(0)
      expect(involicaWethAfter).to.be.eq(0)

      // Alice approval goes to 0, weth goes up
      expect(aliceUsdcApprovalBefore).to.be.eq(defaultFund)
      expect(aliceUsdcApprovalAfter).to.be.eq(0)
      expect(aliceWethAfter.sub(aliceWethBefore)).to.be.gt(0)
    })
    it('Increasing approval should allow user to reInit position', async function () {
      // Create position then set approved to 0
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
      await usdc.connect(alice).approve(involica.address, 0)

      // Finalize task with no approval
      const [canExec, payload] = await resolver.checkPositionExecutable(alice.address)
      await opsContract
        .connect(gelato)
        .exec(
          defaultGelatoFee.div(2),
          ETH_TOKEN_ADDRESS,
          involica.address,
          false,
          true,
          aliceResolverHash,
          involica.address,
          payload,
        )

      // Should fail to reInit without approval
      await expect(involica.connect(alice).reInitPosition()).to.be.revertedWith('Approve for at least 1 DCA')

      // Approve more funds, reInit should be successful
      await usdc.connect(alice).approve(involica.address, defaultFund.mul(1000))

      const tx = await involica.connect(alice).reInitPosition()
      expect(tx).to.emit(involica, 'InitializeTask')
    })
    it('should DCA until wallet balance runs out, then finalize with "Insufficient funds to pull from wallet"', async () => {
      const aliceUsdcInit = await usdc.balanceOf(alice.address)
      await usdc.connect(alice).transfer(bob.address, aliceUsdcInit.sub(defaultFund))
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

      const involicaUsdcBefore = await usdc.balanceOf(involica.address)
      const involicaWethBefore = await weth.balanceOf(involica.address)
      const aliceUsdcBefore = await usdc.balanceOf(alice.address)
      const aliceWethBefore = await weth.balanceOf(alice.address)

      let finalizationReason = ''
      let iteration = 0
      while (iteration < 15 && finalizationReason !== 'Insufficient funds to pull from wallet') {
        const [canExec, payload] = await resolver.checkPositionExecutable(alice.address)
        expect(canExec).to.be.eq(true)

        await opsContract
          .connect(gelato)
          .exec(
            defaultGelatoFee.div(2),
            ETH_TOKEN_ADDRESS,
            involica.address,
            false,
            true,
            aliceResolverHash,
            involica.address,
            payload,
          )

        const now = await getCurrentTimestamp()
        await fastForwardTo(now.add(defaultInterval).toNumber())

        const position = (await involica.fetchUserData(alice.address)).position
        finalizationReason = position.finalizationReason
        iteration++
      }

      const position = (await involica.fetchUserData(alice.address)).position
      expect(position.finalizationReason).to.be.eq('Insufficient funds to pull from wallet')
      expect(position.taskId).to.be.eq(emptyBytes32)

      const involicaUsdcAfter = await usdc.balanceOf(involica.address)
      const involicaWethAfter = await weth.balanceOf(involica.address)
      const aliceUsdcAfter = await usdc.balanceOf(alice.address)
      const aliceWethAfter = await weth.balanceOf(alice.address)

      // Involica contract should never have erc20s
      expect(involicaUsdcBefore).to.be.eq(0)
      expect(involicaUsdcAfter).to.be.eq(0)
      expect(involicaWethBefore).to.be.eq(0)
      expect(involicaWethAfter).to.be.eq(0)

      // Alice approval goes to 0, weth goes up
      expect(aliceUsdcBefore).to.be.eq(defaultFund)
      expect(aliceUsdcAfter).to.be.eq(0)
      expect(aliceWethAfter.sub(aliceWethBefore)).to.be.gt(0)
    })
    it('Increasing wallet balance should allow user to reInit position', async function () {
      // Create position, transfer all funds to bob
      const aliceUsdcInit = await usdc.balanceOf(alice.address)
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
      await usdc.connect(alice).transfer(bob.address, aliceUsdcInit)

      // Finalize task with no wallet balance
      const [canExec, payload] = await resolver.checkPositionExecutable(alice.address)
      await opsContract
        .connect(gelato)
        .exec(
          defaultGelatoFee.div(2),
          ETH_TOKEN_ADDRESS,
          involica.address,
          false,
          true,
          aliceResolverHash,
          involica.address,
          payload,
        )

      // Revert with no wallet balance
      await expect(involica.connect(alice).reInitPosition()).to.be.revertedWith('Wallet balance for at least 1 DCA')

      // Give balance and reInit
      await usdc.connect(bob).transfer(alice.address, defaultFund)

      const tx = await involica.connect(alice).reInitPosition()
      expect(tx).to.emit(involica, 'InitializeTask')
    })
    it('should DCA until treasury runs out, then finalize with Treasury out of gas', async () => {
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

      const balanceBeforeUsdc = await usdc.balanceOf(alice.address)
      const balanceBeforeWeth = await weth.balanceOf(alice.address)

      let finalizationReason = ''
      let iteration = 0
      while (iteration < 15 && finalizationReason !== 'Treasury out of gas') {
        const [canExec, payload] = await resolver.checkPositionExecutable(alice.address)
        expect(canExec).to.be.eq(true)

        const tx = await opsContract
          .connect(gelato)
          .exec(
            defaultGelatoFee.mul(2),
            ETH_TOKEN_ADDRESS,
            involica.address,
            false,
            true,
            aliceResolverHash,
            involica.address,
            payload,
          )

        const now = await getCurrentTimestamp()
        await fastForwardTo(now.add(defaultInterval).toNumber())

        const position = (await involica.fetchUserData(alice.address)).position
        finalizationReason = position.finalizationReason
        iteration++

        if (finalizationReason == '') {
          expect(tx).to.changeEtherBalance(involica, defaultGelatoFee.mul(-2))
        }
      }

      const { position, userTreasury } = await involica.fetchUserData(alice.address)
      expect(position.finalizationReason).to.be.eq('Treasury out of gas')
      expect(userTreasury).to.be.eq(0)
      expect(position.taskId).to.be.eq(emptyBytes32)

      const balanceAfterUsdc = await usdc.balanceOf(alice.address)
      const balanceAfterWeth = await weth.balanceOf(alice.address)

      expect(balanceBeforeUsdc.sub(balanceAfterUsdc)).to.be.eq(defaultDCA.mul(iteration - 1))
      expect(balanceAfterWeth.sub(balanceBeforeWeth)).to.be.gt(0)
    })
    it('depositing treasury funds should re-initialize task', async () => {
      // Create position and drain it
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
      await involica.connect(alice).withdrawTreasury(defaultTreasuryFund)

      const position1 = (await involica.fetchUserData(alice.address)).position
      expect(position1.finalizationReason).to.be.eq('Treasury out of gas')

      // Re-initialize
      const tx = await involica.connect(alice).depositTreasury({ value: defaultTreasuryFund })

      expect(tx).to.emit(involica, 'DepositTreasury').withArgs(alice.address, defaultTreasuryFund)
      expect(tx).to.emit(involica, 'InitializeTask')

      const position2 = (await involica.fetchUserData(alice.address)).position
      expect(position2.finalizationReason).to.be.eq('')

      const [canExec2, payload2] = await resolver.checkPositionExecutable(alice.address)
      const execTx2 = await opsContract
        .connect(gelato)
        .exec(
          defaultGelatoFee.div(2),
          ETH_TOKEN_ADDRESS,
          involica.address,
          false,
          true,
          aliceResolverHash,
          involica.address,
          payload2,
        )

      expect(execTx2).to.emit(involica, 'ExecuteDCA').withArgs(alice.address)
    })
  })
})
