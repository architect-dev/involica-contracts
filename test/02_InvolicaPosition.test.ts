import { ethers } from 'hardhat'
import { Involica, IERC20, InvolicaFetcher } from '../typechain'
import chai from 'chai'
import { solidity } from 'ethereum-waffle'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { ETH_TOKEN_ADDRESS, ROUTER_ADDRESS } from '../constants'
import { BigNumber, BigNumberish } from '@ethersproject/bignumber'
import { fastForwardTo, getCurrentTimestamp, setAllowedToken, setBlacklistedPair, parseGwei, prepare } from './utils'
import { parseEther } from '@ethersproject/units'

const { expect } = chai
chai.use(solidity)

describe('Involica Position', function () {
  let chainId: number
  // let signers: SignerWithAddress[]

  let deployer: SignerWithAddress
  let alice: SignerWithAddress
  let bob: SignerWithAddress

  let opsSigner: SignerWithAddress
  // let gelato: SignerWithAddress
  // let opsGelatoSigner: SignerWithAddress

  let usdc: IERC20
  let weth: IERC20
  let wbtc: IERC20

  let defaultTreasuryFund: BigNumber
  // let defaultFund: BigNumber
  let defaultDCA: BigNumber
  let defaultFee: BigNumber
  let defaultSlippage: BigNumber
  let defaultGasPrice: BigNumberish
  let defaultInterval: BigNumberish
  // let defaultGelatoFee: BigNumber
  let wethSwapRoute: string[]
  let btcSwapRoute: string[]

  let involica: Involica
  // let resolver: InvolicaResolver
  // let oracle: Oracle
  let fetcher: InvolicaFetcher
  // let ops: IOps

  let emptyBytes32: string
  // let aliceResolverHash: string

  let snapshotId: string

  before('setup contracts', async () => {
    ;({
      chainId,
      // signers,
      deployer,
      alice,
      bob,
      opsSigner,
      // gelato,
      // opsGelatoSigner,
      usdc,
      weth,
      wbtc,
      defaultTreasuryFund,
      // defaultFund,
      defaultDCA,
      defaultFee,
      defaultSlippage,
      defaultGasPrice,
      defaultInterval,
      // defaultGelatoFee,
      wethSwapRoute,
      btcSwapRoute,
      involica,
      // resolver,
      // oracle,
      fetcher,
      // ops,
      emptyBytes32,
      // aliceResolverHash,
      snapshotId,
    } = await prepare(250))
  })

  beforeEach(async () => {
    await ethers.provider.send('evm_revert', [snapshotId])
    snapshotId = await ethers.provider.send('evm_snapshot', [])
  })

  describe('setPosition()', async () => {
    beforeEach(async () => {
      await involica.connect(alice).depositTreasury({ value: defaultTreasuryFund })
    })
    it('should revert if system is paused', async () => {
      await involica.connect(deployer).setPaused(true)
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
      ).to.be.revertedWith('Pausable: paused')
    })
    it('should revert if treasury fund amount is 0', async () => {
      await involica.connect(alice).withdrawTreasury(defaultTreasuryFund)

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
      ).to.be.revertedWith('Treasury must not be 0')
    })
    it('should revert if token is not allowed', async () => {
      await setAllowedToken(involica, usdc.address, false)
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
      ).to.be.revertedWith('Token is not allowed')
    })
    it('should revert if token is native token', async () => {
      await setAllowedToken(involica, usdc.address, false)
      await expect(
        involica.connect(alice).setPosition(
          ETH_TOKEN_ADDRESS,
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
      ).to.be.revertedWith('Token is not allowed')
    })
    it('should revert if token pair is blacklisted', async () => {
      await setBlacklistedPair(involica, wethSwapRoute, true)
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
      ).to.be.revertedWith('Pair is blacklisted')
    })
    it('should revert if in and out tokens match', async () => {
      // IN AND OUT TOKENS MATCH
      await expect(
        involica.connect(alice).setPosition(
          usdc.address,
          [
            {
              token: usdc.address,
              weight: 10000,
              route: [usdc.address, usdc.address],
              maxSlippage: defaultSlippage,
            },
          ],
          defaultDCA,
          defaultInterval,
          defaultGasPrice,
        ),
      ).to.be.revertedWith('Same token both sides of pair')
    })
    it('should revert if too many out tokens', async () => {
      await expect(
        involica.connect(alice).setPosition(
          usdc.address,
          new Array(7).fill({
            token: weth.address,
            weight: 9000,
            route: wethSwapRoute,
            maxSlippage: defaultSlippage,
          }),
          defaultDCA,
          defaultInterval,
          defaultGasPrice,
        ),
      ).to.be.revertedWith('No more than 6 out tokens')
    })
    it('should revert if weights are invalid', async () => {
      // INCORRECT WEIGHTS
      await expect(
        involica.connect(alice).setPosition(
          usdc.address,
          [
            {
              token: weth.address,
              weight: 9000,
              route: wethSwapRoute,
              maxSlippage: defaultSlippage,
            },
          ],
          defaultDCA,
          defaultInterval,
          defaultGasPrice,
        ),
      ).to.be.revertedWith('Weights do not sum to 10000')

      // NON ZERO WEIGHTS
      await expect(
        involica.connect(alice).setPosition(
          usdc.address,
          [
            {
              token: weth.address,
              weight: 0,
              route: wethSwapRoute,
              maxSlippage: defaultSlippage,
            },
          ],
          defaultDCA,
          defaultInterval,
          defaultGasPrice,
        ),
      ).to.be.revertedWith('Non zero weight')
    })
    it('should revert if DCA amount is 0', async () => {
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
          0,
          defaultInterval,
          defaultGasPrice,
        ),
      ).to.be.revertedWith('DCA amount must be > 0')
    })
    it('should revert if route has duplicates', async function () {
      await expect(
        involica.connect(alice).setPosition(
          usdc.address,
          [
            {
              token: weth.address,
              weight: 10000,
              route: [usdc.address, usdc.address, weth.address],
              maxSlippage: defaultSlippage,
            },
          ],
          defaultDCA,
          defaultInterval,
          defaultGasPrice,
        ),
      ).to.be.revertedWith('Invalid route')
    })
    it('should revert if route does not match input and output tokens', async function () {
      await expect(
        involica.connect(alice).setPosition(
          usdc.address,
          [
            {
              token: weth.address,
              weight: 10000,
              route: [usdc.address, usdc.address],
              maxSlippage: defaultSlippage,
            },
          ],
          defaultDCA,
          defaultInterval,
          defaultGasPrice,
        ),
      ).to.be.revertedWith('Invalid route')
    })
    it('should revert if maxSlippage is less than minSlippage', async function () {
      await expect(
        involica.connect(alice).setPosition(
          usdc.address,
          [
            {
              token: weth.address,
              weight: 10000,
              route: wethSwapRoute,
              maxSlippage: 0,
            },
          ],
          defaultDCA,
          defaultInterval,
          defaultGasPrice,
        ),
      ).to.be.revertedWith('Invalid slippage')
    })
    it('should revert if output token is invalid', async function () {
      await expect(
        involica.connect(alice).setPosition(
          usdc.address,
          [
            {
              token: ETH_TOKEN_ADDRESS,
              weight: 10000,
              route: [usdc.address, ETH_TOKEN_ADDRESS],
              maxSlippage: defaultSlippage,
            },
          ],
          defaultDCA,
          defaultInterval,
          defaultGasPrice,
        ),
      ).to.be.revertedWith('Token is not allowed')
    })
    it('should revert if interval is less than one minute', async () => {
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
          30,
          defaultGasPrice,
        ),
      ).to.be.revertedWith('DCA interval must be > 60s')
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
    it('should create position, but not move funds', async () => {
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

      const position = (await fetcher.fetchUserData(alice.address)).position
      expect(position.user).to.be.eq(alice.address)
      expect(position.tokenIn).to.be.eq(usdc.address)
      expect(position.outs.length).to.be.eq(1)
      expect(position.outs[0].token).to.be.eq(weth.address)
      expect(position.outs[0].weight).to.be.eq(10000)
      expect(position.outs[0].maxSlippage).to.be.eq(defaultSlippage)
      expect(position.amountDCA).to.be.eq(defaultDCA)
      expect(position.intervalDCA).to.be.eq(defaultInterval)
      expect(position.maxGasPrice).to.be.eq(parseGwei(defaultGasPrice))
      expect(position.lastDCA).to.be.eq(0)
      expect(position.taskId).to.exist
      expect(position.finalizationReason).to.equal('')
    })
    it('user should be added to usersWithPositions when position added', async () => {
      const userHasPositionBefore = (await fetcher.fetchUserData(alice.address)).userHasPosition
      expect(userHasPositionBefore).to.be.false

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

      const userHasPositionAfter = (await fetcher.fetchUserData(alice.address)).userHasPosition
      expect(userHasPositionAfter).to.be.true
    })
  })

  describe('reInitPosition()', async () => {
    beforeEach(async () => {
      await involica.connect(alice).depositTreasury({ value: defaultTreasuryFund })
    })

    it('should revert if user doesnt exist', async function () {
      await expect(involica.connect(alice).reInitPosition()).to.be.revertedWith('User doesnt have a position')
    })
    it('should revert if task already exists', async function () {
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

      await expect(involica.connect(alice).reInitPosition()).to.be.revertedWith('Task already initialized')
    })
    it('should revert if 0 balance treasury', async function () {
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

      await expect(involica.connect(alice).reInitPosition()).to.be.revertedWith('Treasury must not be 0')
    })
    it('should succeed if conditions met', async function () {
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
      const taskId0 = (await fetcher.fetchUserData(alice.address)).position.taskId
      await usdc.connect(alice).approve(involica.address, 0)
      await expect(involica.connect(opsSigner).executeDCA(alice.address, [0]))
        .to.emit(involica, 'FinalizeTask')
        .withArgs(alice.address, taskId0, 'Insufficient approval to pull from wallet')

      const taskIdInit = (await fetcher.fetchUserData(alice.address)).position.taskId
      expect(taskIdInit).to.be.eq(emptyBytes32)

      await usdc.connect(alice).approve(involica.address, ethers.constants.MaxUint256)
      const tx = await involica.connect(alice).reInitPosition()

      const taskIdFinal = (await fetcher.fetchUserData(alice.address)).position.taskId
      expect(tx).to.emit(involica, 'InitializeTask').withArgs(alice.address, taskIdFinal)

      expect(taskIdFinal).to.not.be.null
    })

    // Remaining tests carried out in Gelato Integration
  })

  describe('setPosition() multiple out tokens', async () => {
    it('multiple out tokens with invalid weights should fail', async () => {
      await involica.connect(alice).depositTreasury({ value: defaultTreasuryFund })

      await expect(
        involica.connect(alice).setPosition(
          usdc.address,
          [
            {
              token: weth.address,
              weight: 7000,
              route: wethSwapRoute,
              maxSlippage: defaultSlippage,
            },
            {
              token: wbtc.address,
              weight: 4000,
              route: btcSwapRoute,
              maxSlippage: defaultSlippage,
            },
          ],
          defaultDCA,
          defaultInterval,
          defaultGasPrice,
        ),
      ).to.be.revertedWith('Weights do not sum to 10000')
    })
    it('should create position with 2 out tokens', async () => {
      await involica.connect(alice).depositTreasury({ value: defaultTreasuryFund })

      const balanceAliceBefore = await usdc.balanceOf(alice.address)
      const balanceContractBefore = await usdc.balanceOf(involica.address)

      const tx = await involica.connect(alice).setPosition(
        usdc.address,
        [
          {
            token: wbtc.address,
            weight: 7000,
            route: btcSwapRoute,
            maxSlippage: 200,
          },
          {
            token: weth.address,
            weight: 3000,
            route: wethSwapRoute,
            maxSlippage: defaultSlippage,
          },
        ],
        defaultDCA,
        defaultInterval,
        defaultGasPrice,
      )

      expect(tx).to.emit(involica, 'SetPosition')
      expect(tx).to.emit(involica, 'InitializeTask')

      const balanceAliceAfter = await usdc.balanceOf(alice.address)
      const balanceContractAfter = await usdc.balanceOf(involica.address)

      expect(balanceAliceBefore.sub(balanceAliceAfter)).to.be.eq(0)
      expect(balanceContractAfter.sub(balanceContractBefore)).to.be.eq(0)

      const position = (await fetcher.fetchUserData(alice.address)).position
      expect(position.user).to.be.eq(alice.address)
      expect(position.tokenIn).to.be.eq(usdc.address)
      expect(position.outs.length).to.be.eq(2)
      expect(position.outs[0].token).to.be.eq(wbtc.address)
      expect(position.outs[0].weight).to.be.eq(7000)
      expect(position.outs[0].maxSlippage).to.be.eq(200)
      expect(position.outs[1].token).to.be.eq(weth.address)
      expect(position.outs[1].weight).to.be.eq(3000)
      expect(position.outs[1].maxSlippage).to.be.eq(defaultSlippage)
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

    it('should revert if position does not exist', async () => {
      await expect(involica.connect(deployer).exitPosition()).to.be.revertedWith('User doesnt have a position')
    })
    it('should exit successfully', async () => {
      const { taskId } = (await fetcher.fetchUserData(alice.address)).position
      await involica.connect(opsSigner).executeDCA(alice.address, [0, 0])

      const tx = await involica.connect(alice).exitPosition()

      expect(tx).to.emit(involica, 'WithdrawTreasury').withArgs(alice.address, defaultTreasuryFund)
      expect(tx).to.emit(involica, 'FinalizeTask').withArgs(alice.address, taskId, 'User exited')
      expect(tx).to.emit(involica, 'ExitPosition')

      // Treasury should move back to user's wallet
      expect(tx).to.changeEtherBalance(involica, defaultTreasuryFund.mul(-1))
      expect(tx).to.changeEtherBalance(alice, defaultTreasuryFund)

      // Position should no longer exist
      const userHasPositionAfter = (await fetcher.fetchUserData(alice.address)).userHasPosition
      expect(userHasPositionAfter).to.be.false
    })
    it('functions requiring position should fail after exit', async function () {
      await involica.connect(alice).exitPosition()
      await expect(involica.connect(alice).exitPosition()).to.be.revertedWith('User doesnt have a position')
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

    it('should revert if position does not exist', async () => {
      await expect(involica.connect(opsSigner).executeDCA(bob.address, [0])).to.be.revertedWith(
        'User doesnt have a position',
      )
    })
    it('should revert if sender is not ops or user', async () => {
      await expect(involica.connect(alice).executeDCA(deployer.address, [0])).to.be.revertedWith(
        'Only GelatoOps or User can Execute DCA',
      )
    })
    it('should revert if system is paused', async () => {
      await involica.connect(deployer).setPaused(true)
      await expect(involica.connect(opsSigner).executeDCA(alice.address, [0])).to.be.revertedWith('Pausable: paused')
    })
    it('should not decrease user input balance if swap fails', async () => {
      const aliceBalanceInBefore = await usdc.balanceOf(alice.address)

      await involica.connect(opsSigner).executeDCA(alice.address, [parseEther('10000000000000')])

      const aliceBalanceInAfter = await usdc.balanceOf(alice.address)
      expect(aliceBalanceInBefore).to.be.eq(aliceBalanceInAfter)
    })
    it('should not execute swap if token pair is not allowed, with message "Invalid pair"', async () => {
      await setAllowedToken(involica, usdc.address, false)
      const aliceBalanceInBefore = await usdc.balanceOf(alice.address)

      await involica.connect(opsSigner).executeDCA(alice.address, [0])

      const aliceBalanceInAfter = await usdc.balanceOf(alice.address)
      expect(aliceBalanceInBefore).to.be.eq(aliceBalanceInAfter)

      const txs = await involica.fetchUserTxs(alice.address)
      expect(txs[0].tokenTxs[0].err).to.eq('Invalid pair')
    })
    it('should revert if extra data is invalid', async function () {
      await expect(involica.connect(opsSigner).executeDCA(alice.address, [0, 0])).to.be.revertedWith(
        'Invalid extra data',
      )
    })
    it("should revert if it's not time to DCA", async () => {
      await involica.connect(opsSigner).executeDCA(alice.address, [0])

      const currentTimestamp = await getCurrentTimestamp()
      const lastDCA = (await fetcher.fetchUserData(alice.address)).position.lastDCA
      expect(lastDCA).to.be.eq(currentTimestamp)

      expect(involica.connect(opsSigner).executeDCA(alice.address, [0])).to.be.revertedWith('DCA not mature')
    })
    it('should execute DCA', async () => {
      const dcaAmount = (await fetcher.fetchUserData(alice.address)).position.amountDCA

      const balanceFundBefore = await usdc.balanceOf(alice.address)
      const balanceAssetBefore = await weth.balanceOf(alice.address)

      const uniRouter = await ethers.getContractAt('IUniswapV2Router', ROUTER_ADDRESS[chainId])
      const swapAmounts1 = await uniRouter.getAmountsOut(dcaAmount.mul(9995).div(10000), [usdc.address, weth.address])

      await expect(involica.connect(opsSigner).executeDCA(alice.address, [0])).to.emit(involica, 'FinalizeDCA')

      const balanceFundAfter = await usdc.balanceOf(alice.address)
      const balanceAssetAfter = await weth.balanceOf(alice.address)

      expect(balanceFundBefore.sub(balanceFundAfter)).to.be.eq(defaultDCA)

      const wethDifference1 = balanceAssetAfter.sub(balanceAssetBefore)
      expect(wethDifference1).to.be.gte(swapAmounts1[1])

      const positionAfter = (await fetcher.fetchUserData(alice.address)).position

      const lastDCA = positionAfter.lastDCA
      const nextDCA = lastDCA.add(positionAfter.intervalDCA)

      await fastForwardTo(nextDCA.toNumber())

      const swapAmounts2 = await uniRouter.getAmountsOut(dcaAmount.mul(9995).div(10000), [usdc.address, weth.address])
      await expect(involica.connect(opsSigner).executeDCA(alice.address, [0])).to.emit(involica, 'FinalizeDCA')

      const balanceFundFinal = await usdc.balanceOf(alice.address)
      const balanceAssetFinal = await weth.balanceOf(alice.address)

      expect(balanceFundAfter.sub(balanceFundFinal)).to.be.eq(defaultDCA)

      const wethDifference2 = balanceAssetFinal.sub(balanceAssetAfter)
      expect(wethDifference2).to.be.gte(swapAmounts2[1])

      // TX WITH FAILING TOKEN SWAP
      const finalDCA = nextDCA.add(1).add(positionAfter.intervalDCA)
      await fastForwardTo(finalDCA.toNumber())
      await involica.connect(opsSigner).executeDCA(alice.address, [parseEther('10000000000000')])

      // TEST TX RECEIPTS
      const txs = await involica.fetchUserTxs(alice.address)
      expect(txs.length).to.eq(3)

      expect(txs[0].timestamp).to.eq(lastDCA)
      expect(txs[0].txFee).to.eq(defaultFee)
      expect(txs[0].tokenTxs.length).to.eq(1)
      expect(txs[0].tokenTxs[0].tokenIn).to.eq(usdc.address)
      expect(txs[0].tokenTxs[0].tokenOut).to.eq(weth.address)
      expect(txs[0].tokenTxs[0].amountIn).to.eq(dcaAmount.mul(9995).div(10000))
      expect(txs[0].tokenTxs[0].amountOut).to.eq(wethDifference1)
      expect(txs[0].tokenTxs[0].err).to.eq('')

      expect(txs[1].timestamp).to.eq(nextDCA.add(1))
      expect(txs[1].txFee).to.eq(defaultFee)
      expect(txs[1].tokenTxs.length).to.eq(1)
      expect(txs[1].tokenTxs[0].tokenIn).to.eq(usdc.address)
      expect(txs[1].tokenTxs[0].tokenOut).to.eq(weth.address)
      expect(txs[1].tokenTxs[0].amountIn).to.eq(dcaAmount.mul(9995).div(10000))
      expect(txs[1].tokenTxs[0].amountOut).to.eq(wethDifference2)
      expect(txs[1].tokenTxs[0].err).to.eq('')

      expect(txs[2].timestamp).to.eq(finalDCA.add(1))
      expect(txs[2].txFee).to.eq(0)
      expect(txs[2].tokenTxs.length).to.eq(1)
      expect(txs[2].tokenTxs[0].tokenIn).to.eq(usdc.address)
      expect(txs[2].tokenTxs[0].tokenOut).to.eq(weth.address)
      expect(txs[2].tokenTxs[0].amountIn).to.eq(0)
      expect(txs[2].tokenTxs[0].amountOut).to.eq(0)
      expect(txs[2].tokenTxs[0].err).to.eq('UniswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT')
    })
    it('Position with multiple out tokens should create correct tx receipts', async function () {
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

      const wethBalanceBefore = await weth.balanceOf(alice.address)
      const wbtcBalanceBefore = await wbtc.balanceOf(alice.address)

      const tx = await involica.connect(opsSigner).executeDCA(alice.address, [0, 0])

      const { lastDCA } = (await fetcher.fetchUserData(alice.address)).position
      const wethBalanceAfter = await weth.balanceOf(alice.address)
      const wbtcBalanceAfter = await wbtc.balanceOf(alice.address)

      // TEST TX RECEIPTS
      const txs = await involica.fetchUserTxs(alice.address)
      expect(txs.length).to.eq(1)

      expect(txs[0].timestamp).to.eq(lastDCA)
      expect(txs[0].tokenIn).to.eq(usdc.address)
      expect(txs[0].txFee).to.eq(defaultFee)
      expect(txs[0].tokenTxs.length).to.eq(2)

      expect(txs[0].tokenTxs[0].tokenIn).to.eq(usdc.address)
      expect(txs[0].tokenTxs[0].tokenOut).to.eq(weth.address)
      expect(txs[0].tokenTxs[0].amountIn).to.eq(defaultDCA.mul(2000).mul(9995).div(10000).div(10000))
      expect(txs[0].tokenTxs[0].amountOut).to.eq(wethBalanceAfter.sub(wethBalanceBefore))
      expect(txs[0].tokenTxs[0].err).to.eq('')

      expect(txs[0].tokenTxs[1].tokenIn).to.eq(usdc.address)
      expect(txs[0].tokenTxs[1].tokenOut).to.eq(wbtc.address)
      expect(txs[0].tokenTxs[1].amountIn).to.eq(defaultDCA.mul(8000).mul(9995).div(10000).div(10000))
      expect(txs[0].tokenTxs[1].amountOut).to.eq(wbtcBalanceAfter.sub(wbtcBalanceBefore))
      expect(txs[0].tokenTxs[1].err).to.eq('')

      // TEST EXECUTE DCA EVENT
      const amountSwapped = txs[0].tokenTxs[0].amountIn.add(txs[0].tokenTxs[1].amountIn)
      const outTokens = [weth.address, wbtc.address]
      const outBalances = [txs[0].tokenTxs[0].amountOut, txs[0].tokenTxs[1].amountOut]
      const txFee = defaultFee

      expect(tx)
        .to.emit(involica, 'FinalizeDCA')
        .withArgs(alice.address, usdc.address, amountSwapped, outTokens, outBalances, txFee)
    })
    it('Partial executed swaps should be correct', async function () {
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

      const balanceInBefore = await usdc.balanceOf(alice.address)
      const wethBalanceBefore = await weth.balanceOf(alice.address)

      await involica.connect(opsSigner).executeDCA(alice.address, [0, parseEther('10000000000000')])

      const { lastDCA } = (await fetcher.fetchUserData(alice.address)).position
      const balanceInAfter = await usdc.balanceOf(alice.address)
      const wethBalanceAfter = await weth.balanceOf(alice.address)

      // Partial DCA amount used
      expect(balanceInBefore.sub(balanceInAfter)).to.eq(defaultDCA.mul(2000).div(10000))

      // TEST TX RECEIPTS
      const txs = await involica.fetchUserTxs(alice.address)
      expect(txs.length).to.eq(1)

      expect(txs[0].timestamp).to.eq(lastDCA)
      expect(txs[0].tokenTxs.length).to.eq(2)

      expect(txs[0].tokenTxs[0].tokenIn).to.eq(usdc.address)
      expect(txs[0].tokenTxs[0].tokenOut).to.eq(weth.address)
      expect(txs[0].tokenTxs[0].amountIn).to.eq(defaultDCA.mul(2000).mul(9995).div(10000).div(10000))
      expect(txs[0].tokenTxs[0].amountOut).to.eq(wethBalanceAfter.sub(wethBalanceBefore))
      expect(txs[0].tokenTxs[0].err).to.eq('')

      expect(txs[0].tokenTxs[1].tokenIn).to.eq(usdc.address)
      expect(txs[0].tokenTxs[1].tokenOut).to.eq(wbtc.address)
      expect(txs[0].tokenTxs[1].amountIn).to.eq(0)
      expect(txs[0].tokenTxs[1].amountOut).to.eq(0)
      expect(txs[0].tokenTxs[1].err).to.eq('UniswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT')
    })
    it('swap should take txFee correctly', async () => {
      const treasuryBefore = await usdc.balanceOf(deployer.address)

      await involica.connect(opsSigner).executeDCA(alice.address, [0])

      const treasuryAfter = await usdc.balanceOf(deployer.address)

      expect(treasuryAfter.sub(treasuryBefore)).to.be.eq(defaultFee)
    })
    it('swap should decrease approved amount', async () => {
      await usdc.connect(alice).approve(involica.address, defaultDCA.mul(2))

      const approvedBefore = await usdc.allowance(alice.address, involica.address)

      await involica.connect(opsSigner).executeDCA(alice.address, [0])

      const approvedAfter = await usdc.allowance(alice.address, involica.address)

      expect(approvedBefore.sub(approvedAfter)).to.be.eq(defaultDCA)
    })
    it('swap should decrease approved amount even if swap fails', async () => {
      await usdc.connect(alice).approve(involica.address, defaultDCA.mul(2))

      const approvedBefore = await usdc.allowance(alice.address, involica.address)

      await involica.connect(opsSigner).executeDCA(alice.address, [parseEther('10000000000000')])

      const approvedAfter = await usdc.allowance(alice.address, involica.address)
      const position = (await fetcher.fetchUserData(alice.address)).position

      expect(approvedBefore.sub(approvedAfter)).to.be.eq(position.amountDCA)
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

      const balanceInBefore = await usdc.balanceOf(alice.address)
      const wethBalanceBefore = await weth.balanceOf(alice.address)

      await involica.connect(opsSigner).executeDCA(alice.address, [0, parseEther('10000000000000')])

      const { lastDCA } = (await fetcher.fetchUserData(alice.address)).position
      const balanceInAfter = await usdc.balanceOf(alice.address)
      const wethBalanceAfter = await weth.balanceOf(alice.address)

      // Partial DCA amount used
      expect(balanceInBefore.sub(balanceInAfter)).to.eq(defaultDCA.mul(2000).div(10000))

      // TEST TX RECEIPTS
      const txs = await involica.fetchUserTxs(alice.address)
      expect(txs.length).to.eq(1)

      expect(txs[0].timestamp).to.eq(lastDCA)
      expect(txs[0].txFee).to.eq(defaultFee.mul(2000).div(10000))
      expect(txs[0].tokenTxs.length).to.eq(2)

      expect(txs[0].tokenTxs[0].tokenIn).to.eq(usdc.address)
      expect(txs[0].tokenTxs[0].tokenOut).to.eq(weth.address)
      expect(txs[0].tokenTxs[0].amountIn).to.eq(defaultDCA.mul(2000).mul(9995).div(10000).div(10000))
      expect(txs[0].tokenTxs[0].amountOut).to.eq(wethBalanceAfter.sub(wethBalanceBefore))
      expect(txs[0].tokenTxs[0].err).to.eq('')

      expect(txs[0].tokenTxs[1].tokenIn).to.eq(usdc.address)
      expect(txs[0].tokenTxs[1].tokenOut).to.eq(wbtc.address)
      expect(txs[0].tokenTxs[1].amountIn).to.eq(0)
      expect(txs[0].tokenTxs[1].amountOut).to.eq(0)
      expect(txs[0].tokenTxs[1].err).to.eq('UniswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT')
    })
  })
})
