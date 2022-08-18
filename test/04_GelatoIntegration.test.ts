import { ethers } from 'hardhat'
import { Involica, InvolicaResolver, IERC20, IOps, InvolicaFetcher } from '../typechain'
import chai from 'chai'
import { solidity } from 'ethereum-waffle'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { ETH_TOKEN_ADDRESS } from '../constants'
import { BigNumber, BigNumberish } from '@ethersproject/bignumber'
import { fastForwardTo, getCurrentTimestamp, parseGwei, prepare } from './utils'

const { expect } = chai
chai.use(solidity)

describe('Integration Test: Gelato DCA', function () {
  // let chainId: number
  // let signers: SignerWithAddress[]

  // let deployer: SignerWithAddress
  let alice: SignerWithAddress
  let bob: SignerWithAddress

  // let opsSigner: SignerWithAddress
  // let gelato: SignerWithAddress
  let opsGelatoSigner: SignerWithAddress

  let usdc: IERC20
  let weth: IERC20
  // let wbtc: IERC20

  let defaultTreasuryFund: BigNumber
  let defaultFund: BigNumber
  let defaultDCA: BigNumber
  // let defaultFee: BigNumber
  let defaultSlippage: BigNumber
  let defaultGasPrice: BigNumberish
  let defaultInterval: BigNumberish
  let defaultGelatoFee: BigNumber
  // let wethSwapRoute: string[]
  // let btcSwapRoute: string[]

  let involica: Involica
  let resolver: InvolicaResolver
  // let oracle: Oracle
  let fetcher: InvolicaFetcher
  let ops: IOps

  // let emptyBytes32: string
  let aliceResolverHash: string

  let snapshotId: string

  before('setup contracts', async () => {
    ;({
      // chainId,
      // signers,
      // deployer,
      alice,
      bob,
      // opsSigner,
      // gelato,
      opsGelatoSigner,
      usdc,
      weth,
      // wbtc,
      defaultTreasuryFund,
      defaultFund,
      defaultDCA,
      // defaultFee,
      defaultSlippage,
      defaultGasPrice,
      defaultInterval,
      defaultGelatoFee,
      // wethSwapRoute,
      // btcSwapRoute,
      involica,
      resolver,
      // oracle,
      fetcher,
      ops,
      // emptyBytes32,
      aliceResolverHash,
      snapshotId,
    } = await prepare(250))
  })

  beforeEach(async () => {
    await ethers.provider.send('evm_revert', [snapshotId])
    snapshotId = await ethers.provider.send('evm_snapshot', [])
  })

  describe('Gelato DCA fromWallet', async () => {
    it('should DCA until approval runs out, then finalize with "Insufficient allowance"', async () => {
      await usdc.connect(alice).approve(involica.address, defaultFund)
      await involica.connect(alice).depositTreasury({ value: defaultTreasuryFund })
      await involica.connect(alice).setPosition(
        alice.address,
        usdc.address,
        [
          {
            token: weth.address,
            weight: 10000,
            maxSlippage: defaultSlippage,
          },
        ],
        defaultDCA,
        defaultInterval,
        defaultGasPrice,
        true,
      )

      const involicaUsdcBefore = await usdc.balanceOf(involica.address)
      const involicaWethBefore = await weth.balanceOf(involica.address)
      const aliceUsdcApprovalBefore = await usdc.allowance(alice.address, involica.address)
      const aliceWethBefore = await weth.balanceOf(alice.address)

      let dcaRevertReason = ''
      let iteration = 0
      while (iteration < 15 && dcaRevertReason !== 'Insufficient allowance') {
        const [canExec, payload] = await resolver.checkPositionExecutable(alice.address)
        expect(canExec).to.be.eq(true)

        await ops
          .connect(opsGelatoSigner)
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

        dcaRevertReason = (await fetcher.fetchUserData(alice.address)).dcaRevertReason
        iteration++
      }

      expect(dcaRevertReason).to.be.eq('Insufficient allowance')

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
        alice.address,
        usdc.address,
        [
          {
            token: weth.address,
            weight: 10000,
            maxSlippage: defaultSlippage,
          },
        ],
        defaultDCA,
        defaultInterval,
        defaultGasPrice,
        true,
      )

      // Position should not have a revert reason
      const reason0 = (await fetcher.fetchUserData(alice.address)).dcaRevertReason
      expect(reason0).to.be.eq('')

      // Set approved to 0
      await usdc.connect(alice).approve(involica.address, 0)

      // Should throw insufficient allowance
      const reason1 = (await fetcher.fetchUserData(alice.address)).dcaRevertReason
      expect(reason1).to.be.eq('Insufficient allowance')

      // Approve more funds, reInit should be successful
      await usdc.connect(alice).approve(involica.address, defaultFund.mul(1000))

      const reason2 = (await fetcher.fetchUserData(alice.address)).dcaRevertReason
      expect(reason2).to.be.eq('')
    })
    it('should DCA until wallet balance runs out, then finalize with "Insufficient balance"', async () => {
      const aliceUsdcInit = await usdc.balanceOf(alice.address)
      await usdc.connect(alice).transfer(bob.address, aliceUsdcInit.sub(defaultFund))
      await involica.connect(alice).depositTreasury({ value: defaultTreasuryFund })
      await involica.connect(alice).setPosition(
        alice.address,
        usdc.address,
        [
          {
            token: weth.address,
            weight: 10000,
            maxSlippage: defaultSlippage,
          },
        ],
        defaultDCA,
        defaultInterval,
        defaultGasPrice,
        true,
      )

      const involicaUsdcBefore = await usdc.balanceOf(involica.address)
      const involicaWethBefore = await weth.balanceOf(involica.address)
      const aliceUsdcBefore = await usdc.balanceOf(alice.address)
      const aliceWethBefore = await weth.balanceOf(alice.address)

      let dcaRevertReason = ''
      let iteration = 0
      while (iteration < 15 && dcaRevertReason !== 'Insufficient balance') {
        const [canExec, payload] = await resolver.checkPositionExecutable(alice.address)
        expect(canExec).to.be.eq(true)

        await ops
          .connect(opsGelatoSigner)
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

        dcaRevertReason = (await fetcher.fetchUserData(alice.address)).dcaRevertReason
        iteration++
      }

      expect(dcaRevertReason).to.be.eq('Insufficient balance')

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
        alice.address,
        usdc.address,
        [
          {
            token: weth.address,
            weight: 10000,
            maxSlippage: defaultSlippage,
          },
        ],
        defaultDCA,
        defaultInterval,
        defaultGasPrice,
        true,
      )

      // Position should not have a revert reason
      const reason0 = (await fetcher.fetchUserData(alice.address)).dcaRevertReason
      expect(reason0).to.be.eq('')

      // Set balance to 0
      await usdc.connect(alice).transfer(bob.address, aliceUsdcInit)

      // Should throw insufficient allowance
      const reason1 = (await fetcher.fetchUserData(alice.address)).dcaRevertReason
      expect(reason1).to.be.eq('Insufficient balance')

      // Give balance and reInit
      await usdc.connect(bob).transfer(alice.address, defaultFund)

      const reason2 = (await fetcher.fetchUserData(alice.address)).dcaRevertReason
      expect(reason2).to.be.eq('')
    })
    it('should DCA until treasury runs out, then finalize with Treasury out of gas', async () => {
      await involica.connect(alice).depositTreasury({ value: defaultTreasuryFund })
      await involica.connect(alice).setPosition(
        alice.address,
        usdc.address,
        [
          {
            token: weth.address,
            weight: 10000,
            maxSlippage: defaultSlippage,
          },
        ],
        defaultDCA,
        defaultInterval,
        defaultGasPrice,
        true,
      )

      const gasEstimation = ((450000 + 1 * 195000) * parseGwei(100).toNumber()).toString()

      const balanceBeforeUsdc = await usdc.balanceOf(alice.address)
      const balanceBeforeWeth = await weth.balanceOf(alice.address)

      let dcaRevertReason = ''
      let iteration = 0
      while (iteration < 15 && dcaRevertReason !== 'Treasury out of gas') {
        const [canExec, payload] = await resolver.checkPositionExecutable(alice.address)

        expect(canExec).to.be.eq(true)

        const tx = await ops
          .connect(opsGelatoSigner)
          .exec(
            gasEstimation,
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

        dcaRevertReason = (await fetcher.fetchUserData(alice.address)).dcaRevertReason
        iteration++

        if (dcaRevertReason == '') {
          expect(tx).to.changeEtherBalance(involica, BigNumber.from(gasEstimation).mul(-1))
        }
      }

      const { userTreasury } = await fetcher.fetchUserData(alice.address)
      expect(dcaRevertReason).to.be.eq('Treasury out of gas')
      expect(userTreasury).to.be.lt(gasEstimation)

      const balanceAfterUsdc = await usdc.balanceOf(alice.address)
      const balanceAfterWeth = await weth.balanceOf(alice.address)

      expect(balanceBeforeUsdc.sub(balanceAfterUsdc)).to.be.eq(defaultDCA.mul(iteration))
      expect(balanceAfterWeth.sub(balanceBeforeWeth)).to.be.gt(0)
    })
    it('depositing treasury funds should re-initialize task', async () => {
      // Create position and drain it
      await involica.connect(alice).depositTreasury({ value: defaultTreasuryFund })
      await involica.connect(alice).setPosition(
        alice.address,
        usdc.address,
        [
          {
            token: weth.address,
            weight: 10000,
            maxSlippage: defaultSlippage,
          },
        ],
        defaultDCA,
        defaultInterval,
        defaultGasPrice,
        true,
      )
      await involica.connect(alice).withdrawTreasury(defaultTreasuryFund)

      const dcaRevertReason1 = (await fetcher.fetchUserData(alice.address)).dcaRevertReason
      expect(dcaRevertReason1).to.be.eq('Treasury out of gas')

      // Re-initialize
      const tx = await involica.connect(alice).depositTreasury({ value: defaultTreasuryFund })

      expect(tx).to.emit(involica, 'DepositTreasury').withArgs(alice.address, defaultTreasuryFund)

      const dcaRevertReason2 = (await fetcher.fetchUserData(alice.address)).dcaRevertReason
      expect(dcaRevertReason2).to.be.eq('')

      const now = await getCurrentTimestamp()
      await fastForwardTo(now.add(defaultInterval).toNumber())

      const payload = await resolver.checkPositionExecutable(alice.address)
      const payload2 = payload[1]
      const execTx2 = await ops
        .connect(opsGelatoSigner)
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

      expect(execTx2).to.emit(involica, 'FinalizeDCA')
    })
    it('depositing treasury funds should not re-initialize task if allowance or balance insufficient', async () => {
      // Create position and drain it
      await involica.connect(alice).depositTreasury({ value: defaultTreasuryFund })
      await involica.connect(alice).setPosition(
        alice.address,
        usdc.address,
        [
          {
            token: weth.address,
            weight: 10000,
            maxSlippage: defaultSlippage,
          },
        ],
        defaultDCA,
        defaultInterval,
        defaultGasPrice,
        true,
      )
      await involica.connect(alice).withdrawTreasury(defaultTreasuryFund)

      const dcaRevertReason1 = (await fetcher.fetchUserData(alice.address)).dcaRevertReason
      expect(dcaRevertReason1).to.be.eq('Treasury out of gas')

      // Set Insufficient allowance and balance
      await usdc.connect(alice).approve(involica.address, 0)
      await usdc.connect(alice).transfer(bob.address, await usdc.balanceOf(alice.address))
      expect(await usdc.allowance(alice.address, involica.address)).to.be.eq(0)
      expect(await usdc.balanceOf(alice.address)).to.be.eq(0)

      expect((await fetcher.fetchUserData(alice.address)).dcaRevertReason).to.equal('Insufficient allowance')

      // Set Sufficient allowance
      await usdc.connect(alice).approve(involica.address, defaultDCA)
      expect((await fetcher.fetchUserData(alice.address)).dcaRevertReason).to.equal('Insufficient balance')

      // Set Sufficient balance
      await usdc.connect(bob).transfer(alice.address, await usdc.balanceOf(bob.address))
      expect((await fetcher.fetchUserData(alice.address)).dcaRevertReason).to.equal('Treasury out of gas')

      // Set Sufficient Treasury
      await involica.connect(alice).depositTreasury({ value: defaultTreasuryFund })
      expect((await fetcher.fetchUserData(alice.address)).dcaRevertReason).to.equal('')
    })
  })
})
