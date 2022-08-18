import { ethers } from 'hardhat'
import { Involica, IERC20, InvolicaFetcher, Oracle } from '../typechain'
import chai from 'chai'
import { solidity } from 'ethereum-waffle'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { ETH_TOKEN_ADDRESS, ROUTER_ADDRESS } from '../constants'
import { BigNumber, BigNumberish } from '@ethersproject/bignumber'
import {
  fastForwardTo,
  getCurrentTimestamp,
  setAllowedToken,
  setBlacklistedPair,
  parseGwei,
  prepare,
  getExpectedLastDCA,
} from './utils'
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
  let oracle: Oracle
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
      oracle,
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
          false,
        ),
      ).to.be.revertedWith('Pausable: paused')
    })
    it('should revert if treasury fund amount is 0', async () => {
      await involica.connect(alice).withdrawTreasury(defaultTreasuryFund)

      await expect(
        involica.connect(alice).setPosition(
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
          false,
        ),
      ).to.be.revertedWith('Treasury must not be 0')
    })
    it('should revert if maxGasPrice too low', async () => {
      await setAllowedToken(involica, usdc.address, false)
      await expect(
        involica.connect(alice).setPosition(
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
          1e9,
          true,
          false,
        ),
      ).to.be.revertedWith('Max gas price must be >= 3 gwei')
    })
    it('should revert if token is not allowed', async () => {
      await setAllowedToken(involica, usdc.address, false)
      await expect(
        involica.connect(alice).setPosition(
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
          false,
        ),
      ).to.be.revertedWith('Token is not allowed')
    })
    it('should revert if token is native token', async () => {
      await setAllowedToken(involica, usdc.address, false)
      await expect(
        involica.connect(alice).setPosition(
          alice.address,
          ETH_TOKEN_ADDRESS,
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
          false,
        ),
      ).to.be.revertedWith('Token is not allowed')
    })
    it('should revert if token pair is blacklisted', async () => {
      await setBlacklistedPair(involica, wethSwapRoute, true)
      await expect(
        involica.connect(alice).setPosition(
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
          false,
        ),
      ).to.be.revertedWith('Pair is blacklisted')
    })
    it('should revert if in and out tokens match', async () => {
      // IN AND OUT TOKENS MATCH
      await expect(
        involica.connect(alice).setPosition(
          alice.address,
          usdc.address,
          [
            {
              token: usdc.address,
              weight: 10000,
              maxSlippage: defaultSlippage,
            },
          ],
          defaultDCA,
          defaultInterval,
          defaultGasPrice,
          true,
          false,
        ),
      ).to.be.revertedWith('Same token both sides of pair')
    })
    it('should revert if too many out tokens', async () => {
      await expect(
        involica.connect(alice).setPosition(
          alice.address,
          usdc.address,
          new Array(8)
            .fill({
              token: weth.address,
              weight: 1000,
              route: wethSwapRoute,
              maxSlippage: defaultSlippage,
            })
            .concat({
              token: weth.address,
              weight: 2000,
              route: wethSwapRoute,
              maxSlippage: defaultSlippage,
            }),
          defaultDCA,
          defaultInterval,
          defaultGasPrice,
          true,
          false,
        ),
      ).to.be.revertedWith('No more than 8 out tokens')
    })
    it('should revert if weights are invalid', async () => {
      // INCORRECT WEIGHTS
      await expect(
        involica.connect(alice).setPosition(
          alice.address,
          usdc.address,
          [
            {
              token: weth.address,
              weight: 9000,
              maxSlippage: defaultSlippage,
            },
          ],
          defaultDCA,
          defaultInterval,
          defaultGasPrice,
          true,
          false,
        ),
      ).to.be.revertedWith('Weights do not sum to 10000')

      // NON ZERO WEIGHTS
      await expect(
        involica.connect(alice).setPosition(
          alice.address,
          usdc.address,
          [
            {
              token: weth.address,
              weight: 0,
              maxSlippage: defaultSlippage,
            },
          ],
          defaultDCA,
          defaultInterval,
          defaultGasPrice,
          true,
          false,
        ),
      ).to.be.revertedWith('Non zero weight')
    })
    it('should revert if DCA amount is 0', async () => {
      await expect(
        involica.connect(alice).setPosition(
          alice.address,
          usdc.address,
          [
            {
              token: weth.address,
              weight: 10000,
              maxSlippage: defaultSlippage,
            },
          ],
          0,
          defaultInterval,
          defaultGasPrice,
          true,
          false,
        ),
      ).to.be.revertedWith('DCA amount must be > 0')
    })
    it('should revert if maxSlippage is less than minSlippage', async function () {
      await expect(
        involica.connect(alice).setPosition(
          alice.address,
          usdc.address,
          [
            {
              token: weth.address,
              weight: 10000,
              maxSlippage: 0,
            },
          ],
          defaultDCA,
          defaultInterval,
          defaultGasPrice,
          true,
          false,
        ),
      ).to.be.revertedWith('Invalid slippage')
    })
    it('should revert if output token is invalid', async function () {
      await expect(
        involica.connect(alice).setPosition(
          alice.address,
          usdc.address,
          [
            {
              token: ETH_TOKEN_ADDRESS,
              weight: 10000,
              maxSlippage: defaultSlippage,
            },
          ],
          defaultDCA,
          defaultInterval,
          defaultGasPrice,
          true,
          false,
        ),
      ).to.be.revertedWith('Token is not allowed')
    })
    it('should revert if interval is less than one minute', async () => {
      await expect(
        involica.connect(alice).setPosition(
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
          30,
          defaultGasPrice,
          true,
          false,
        ),
      ).to.be.revertedWith('DCA interval must be >= 60s')
    })
    it('should revert if allowance is 0', async function () {
      await usdc.connect(alice).approve(involica.address, 0)
      await expect(
        involica.connect(alice).setPosition(
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
          false,
        ),
      ).to.be.revertedWith('Approve for at least 1 DCA')
    })
    it('should revert if wallet balance is 0', async () => {
      const aliceUsdcBalance = await usdc.balanceOf(alice.address)
      await usdc.connect(alice).transfer(bob.address, aliceUsdcBalance)
      await expect(
        involica.connect(alice).setPosition(
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
          false,
        ),
      ).to.be.revertedWith('Wallet balance for at least 1 DCA')
    })
    it('should create position, but not move funds', async () => {
      const aliceUsdcBefore = await usdc.balanceOf(alice.address)
      const tx = await involica.connect(alice).setPosition(
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
        false,
      )

      const expectedLastDCA = await getExpectedLastDCA()

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
      expect(position.maxGasPrice).to.be.eq(defaultGasPrice)
      expect(position.lastDCA).to.be.eq(expectedLastDCA)
      expect(position.taskId).to.exist
    })
    it('user should be added to usersWithPositions when position added', async () => {
      const userHasPositionBefore = (await fetcher.fetchUserData(alice.address)).userHasPosition
      expect(userHasPositionBefore).to.be.false

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
        false,
      )

      const userHasPositionAfter = (await fetcher.fetchUserData(alice.address)).userHasPosition
      expect(userHasPositionAfter).to.be.true
    })
  })

  describe('setPosition() multiple out tokens', async () => {
    it('multiple out tokens with invalid weights should fail', async () => {
      await involica.connect(alice).depositTreasury({ value: defaultTreasuryFund })

      await expect(
        involica.connect(alice).setPosition(
          alice.address,
          usdc.address,
          [
            {
              token: weth.address,
              weight: 7000,
              maxSlippage: defaultSlippage,
            },
            {
              token: wbtc.address,
              weight: 4000,
              maxSlippage: defaultSlippage,
            },
          ],
          defaultDCA,
          defaultInterval,
          defaultGasPrice,
          true,
          false,
        ),
      ).to.be.revertedWith('Weights do not sum to 10000')
    })
    it('should create position with 2 out tokens', async () => {
      await involica.connect(alice).depositTreasury({ value: defaultTreasuryFund })

      const balanceAliceBefore = await usdc.balanceOf(alice.address)
      const balanceContractBefore = await usdc.balanceOf(involica.address)

      const tx = await involica.connect(alice).setPosition(
        alice.address,
        usdc.address,
        [
          {
            token: wbtc.address,
            weight: 7000,
            maxSlippage: 200,
          },
          {
            token: weth.address,
            weight: 3000,
            maxSlippage: defaultSlippage,
          },
        ],
        defaultDCA,
        defaultInterval,
        defaultGasPrice,
        true,
        false,
      )

      expect(tx).to.emit(involica, 'SetPosition')
      expect(tx).to.emit(involica, 'InitializeTask')

      const expectedLastDCA = await getExpectedLastDCA()

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
      expect(position.maxGasPrice).to.be.eq(defaultGasPrice)
      expect(position.lastDCA).to.be.eq(expectedLastDCA)
      expect(position.taskId).to.exist
    })
  })

  describe('exitPosition()', async () => {
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

    it('should revert if position does not exist', async () => {
      await expect(involica.connect(deployer).exitPosition()).to.be.revertedWith('User doesnt have a position')
    })
    it('should exit successfully', async () => {
      await involica.connect(opsSigner).executeDCA(alice.address, 1e6, [wethSwapRoute, btcSwapRoute], [0, 0], [0, 0])

      const tx = await involica.connect(alice).exitPosition()

      expect(tx).to.emit(involica, 'WithdrawTreasury').withArgs(alice.address, defaultTreasuryFund)
      expect(tx).to.emit(involica, 'ExitPosition')

      // Treasury should move back to user's wallet
      expect(tx).to.changeEtherBalance(involica, defaultTreasuryFund.mul(-1))
      expect(tx).to.changeEtherBalance(alice, defaultTreasuryFund)

      // Position should no longer exist
      const { userHasPosition: userHasPositionAfter, position } = await fetcher.fetchUserData(alice.address)
      expect(userHasPositionAfter).to.be.false
      expect(position.lastDCA).to.eq(0)
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
        false,
      )
    })

    it('should revert if system is paused', async () => {
      await involica.connect(deployer).setPaused(true)
      await expect(
        involica.connect(opsSigner).executeDCA(alice.address, 1e6, [wethSwapRoute], [0], [0]),
      ).to.be.revertedWith('Pausable: paused')
    })
    it('should revert if position does not exist', async () => {
      await expect(
        involica.connect(opsSigner).executeDCA(bob.address, 1e6, [wethSwapRoute], [0], [0]),
      ).to.be.revertedWith('User doesnt have a position')
    })
    it('should revert if sender is not ops or user', async () => {
      await expect(
        involica.connect(alice).executeDCA(deployer.address, 1e6, [wethSwapRoute], [0], [0]),
      ).to.be.revertedWith('Only GelatoOps or User can Execute DCA')
    })
    it('should revert if gas too expensive', async () => {
      await expect(
        involica
          .connect(opsSigner)
          .executeDCA(alice.address, 1e6, [wethSwapRoute], [0], [0], { gasPrice: parseGwei(150), gasLimit: 2000000 }),
      ).to.be.revertedWith('Gas too expensive')
    })
    it('should not decrease user input balance if swap fails', async () => {
      const aliceBalanceInBefore = await usdc.balanceOf(alice.address)

      await involica
        .connect(opsSigner)
        .executeDCA(alice.address, 1e6, [wethSwapRoute], [parseEther('10000000000000')], [0])

      const aliceBalanceInAfter = await usdc.balanceOf(alice.address)
      expect(aliceBalanceInBefore).to.be.eq(aliceBalanceInAfter)
    })
    it('should not execute swap if token pair is not allowed, with message "Invalid pair"', async () => {
      await setAllowedToken(involica, usdc.address, false)
      const aliceBalanceInBefore = await usdc.balanceOf(alice.address)

      await involica.connect(opsSigner).executeDCA(alice.address, 1e6, [wethSwapRoute], [0], [0])

      const aliceBalanceInAfter = await usdc.balanceOf(alice.address)
      expect(aliceBalanceInBefore).to.be.eq(aliceBalanceInAfter)

      const txs = await involica.fetchUserTxs(alice.address)
      expect(txs[0].tokenTxs[0].err).to.eq('Invalid pair')
    })
    it('should revert if invalid number of swap routes', async function () {
      await expect(involica.connect(opsSigner).executeDCA(alice.address, 1e6, [], [0], [0])).to.be.revertedWith(
        'Routes for swaps is invalid',
      )
      await expect(
        involica.connect(opsSigner).executeDCA(alice.address, 1e6, [wethSwapRoute, wethSwapRoute], [0], [0]),
      ).to.be.revertedWith('Routes for swaps is invalid')
    })
    it('swap should fail with error "Invalid route" (route has duplicates)', async function () {
      const aliceBalanceInBefore = await usdc.balanceOf(alice.address)

      await involica
        .connect(opsSigner)
        .executeDCA(alice.address, 1e6, [[usdc.address, usdc.address, weth.address]], [0], [0])

      const aliceBalanceInAfter = await usdc.balanceOf(alice.address)
      expect(aliceBalanceInBefore).to.be.eq(aliceBalanceInAfter)

      const txs = await involica.fetchUserTxs(alice.address)
      expect(txs[0].tokenTxs[0].err).to.eq('Invalid route')
    })
    it('swap should fail with error "Invalid route" (route doesnt match input/output tokens)', async function () {
      const aliceBalanceInBefore = await usdc.balanceOf(alice.address)

      await involica.connect(opsSigner).executeDCA(alice.address, 1e6, [btcSwapRoute], [0], [0])

      const aliceBalanceInAfter = await usdc.balanceOf(alice.address)
      expect(aliceBalanceInBefore).to.be.eq(aliceBalanceInAfter)

      const txs = await involica.fetchUserTxs(alice.address)
      expect(txs[0].tokenTxs[0].err).to.eq('Invalid route')
    })
    it('should revert if invalid number of swaps amounts out min', async function () {
      await expect(
        involica.connect(opsSigner).executeDCA(alice.address, 1e6, [wethSwapRoute], [0, 0], [0]),
      ).to.be.revertedWith('AmountOut for swaps is invalid')
    })
    it('should revert if invalid number of out prices', async function () {
      await expect(
        involica.connect(opsSigner).executeDCA(alice.address, 1e6, [wethSwapRoute], [0], [0, 0]),
      ).to.be.revertedWith('OutPrices for swaps is invalid')
    })
    it('should revert until DCA matures', async () => {
      await involica.connect(opsSigner).executeDCA(alice.address, 1e6, [wethSwapRoute], [0], [0])

      const lastDCA = (await fetcher.fetchUserData(alice.address)).position.lastDCA

      await expect(
        involica.connect(opsSigner).executeDCA(alice.address, 1e6, [wethSwapRoute], [0], [0]),
      ).to.be.revertedWith('DCA not mature')

      await fastForwardTo(Number(lastDCA) + Number(defaultInterval) / 2)

      await expect(
        involica.connect(opsSigner).executeDCA(alice.address, 1e6, [wethSwapRoute], [0], [0]),
      ).to.be.revertedWith('DCA not mature')

      await fastForwardTo(Number(lastDCA) + Number(defaultInterval) - 2)

      await expect(
        involica.connect(opsSigner).executeDCA(alice.address, 1e6, [wethSwapRoute], [0], [0]),
      ).to.be.revertedWith('DCA not mature')

      await fastForwardTo(Number(lastDCA) + Number(defaultInterval))

      await expect(involica.connect(opsSigner).executeDCA(alice.address, 1e6, [wethSwapRoute], [0], [0])).to.not.be
        .reverted
    })
    it('DCA execution time should not drift', async () => {
      await involica.connect(opsSigner).executeDCA(alice.address, 1e6, [wethSwapRoute], [0], [0])
      const lastDCA = (await fetcher.fetchUserData(alice.address)).position.lastDCA

      await fastForwardTo(Number(lastDCA) + Number(defaultInterval) + 10)
      await involica.connect(opsSigner).executeDCA(alice.address, 1e6, [wethSwapRoute], [0], [0])

      await fastForwardTo(Number(lastDCA) + Number(defaultInterval) * 2 + 30)
      await involica.connect(opsSigner).executeDCA(alice.address, 1e6, [wethSwapRoute], [0], [0])

      await fastForwardTo(Number(lastDCA) + Number(defaultInterval) * 3 + 2)
      await involica.connect(opsSigner).executeDCA(alice.address, 1e6, [wethSwapRoute], [0], [0])

      await fastForwardTo(Number(lastDCA) + Number(defaultInterval) * 4 + 20)
      await involica.connect(opsSigner).executeDCA(alice.address, 1e6, [wethSwapRoute], [0], [0])
      const lastDCAFinal = (await fetcher.fetchUserData(alice.address)).position.lastDCA

      expect(lastDCAFinal).to.eq(Number(lastDCA) + Number(defaultInterval) * 4)
    })
    it('DCA execution time should snap to current if more than 2 intervals have passed', async () => {
      await involica.connect(opsSigner).executeDCA(alice.address, 1e6, [wethSwapRoute], [0], [0])
      const lastDCA = (await fetcher.fetchUserData(alice.address)).position.lastDCA

      await fastForwardTo(Number(lastDCA) + Number(defaultInterval) * 2 + 35)
      await involica.connect(opsSigner).executeDCA(alice.address, 1e6, [wethSwapRoute], [0], [0])
      const currentTimestamp = await getCurrentTimestamp()
      const lastDCAFinal = (await fetcher.fetchUserData(alice.address)).position.lastDCA

      expect(lastDCAFinal).to.be.gt(Number(lastDCA) + Number(defaultInterval) * 2 + 35)
      expect(lastDCAFinal).to.eq(currentTimestamp)
    })
    it('Updating position should not change lastDCA or taskId', async () => {
      const { taskId, lastDCA } = (await fetcher.fetchUserData(alice.address)).position

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
        false,
      )

      const { taskId: taskIdFinal, lastDCA: lastDCAFinal } = (await fetcher.fetchUserData(alice.address)).position

      expect(taskId).to.eq(taskIdFinal)
      expect(lastDCA).to.eq(lastDCAFinal)
    })
    it('ExecuteInitially = false, should revert initially until DCA matures', async () => {
      await involica.connect(bob).depositTreasury({ value: defaultTreasuryFund })
      await involica.connect(bob).setPosition(
        bob.address,
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
        false,
        false,
      )
      const currentTimestamp = await getCurrentTimestamp()
      const lastDCA = (await fetcher.fetchUserData(bob.address)).position.lastDCA
      expect(lastDCA).to.be.eq(currentTimestamp)

      await expect(
        involica.connect(opsSigner).executeDCA(bob.address, 1e6, [wethSwapRoute], [0], [0]),
      ).to.be.revertedWith('DCA not mature')

      await fastForwardTo(Number(lastDCA) + Number(defaultInterval) / 2)

      await expect(
        involica.connect(opsSigner).executeDCA(bob.address, 1e6, [wethSwapRoute], [0], [0]),
      ).to.be.revertedWith('DCA not mature')

      await fastForwardTo(Number(lastDCA) + Number(defaultInterval) - 2)

      await expect(
        involica.connect(opsSigner).executeDCA(bob.address, 1e6, [wethSwapRoute], [0], [0]),
      ).to.be.revertedWith('DCA not mature')

      await fastForwardTo(Number(lastDCA) + Number(defaultInterval))

      await expect(involica.connect(opsSigner).executeDCA(bob.address, 1e6, [wethSwapRoute], [0], [0])).to.not.be
        .reverted
    })
    it('should execute DCA', async () => {
      const dcaAmount = (await fetcher.fetchUserData(alice.address)).position.amountDCA

      const balanceFundBefore = await usdc.balanceOf(alice.address)
      const balanceAssetBefore = await weth.balanceOf(alice.address)

      const uniRouter = await ethers.getContractAt('IUniswapV2Router', ROUTER_ADDRESS[chainId])
      const swapAmounts1 = await uniRouter.getAmountsOut(dcaAmount.mul(9995).div(10000), [usdc.address, weth.address])

      await expect(involica.connect(opsSigner).executeDCA(alice.address, 1e6, [wethSwapRoute], [0], [0])).to.emit(
        involica,
        'FinalizeDCA',
      )

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

      // ALSO TESTS MANUAL EXECUTION
      await expect(involica.connect(alice).executeDCA(alice.address, 1e6, [wethSwapRoute], [0], [0])).to.emit(
        involica,
        'FinalizeDCA',
      )

      const balanceFundFinal = await usdc.balanceOf(alice.address)
      const balanceAssetFinal = await weth.balanceOf(alice.address)

      expect(balanceFundAfter.sub(balanceFundFinal)).to.be.eq(defaultDCA)

      const wethDifference2 = balanceAssetFinal.sub(balanceAssetAfter)
      expect(wethDifference2).to.be.gte(swapAmounts2[1])

      // TX WITH FAILING TOKEN SWAP
      const finalDCA = nextDCA.add(1).add(positionAfter.intervalDCA)
      await fastForwardTo(finalDCA.toNumber())
      await involica
        .connect(opsSigner)
        .executeDCA(alice.address, 1e6, [wethSwapRoute], [parseEther('10000000000000')], [0])

      // TEST TX RECEIPTS
      const txs = await involica.fetchUserTxs(alice.address)
      expect(txs.length).to.eq(3)

      expect(txs[0].txFee).to.eq(defaultFee)
      expect(txs[0].tokenTxs.length).to.eq(1)
      expect(txs[0].tokenTxs[0].tokenIn).to.eq(usdc.address)
      expect(txs[0].tokenTxs[0].tokenOut).to.eq(weth.address)
      expect(txs[0].tokenTxs[0].amountIn).to.eq(dcaAmount.mul(9995).div(10000))
      expect(txs[0].tokenTxs[0].amountOut).to.eq(wethDifference1)
      expect(txs[0].tokenTxs[0].err).to.eq('')

      expect(txs[1].txFee).to.eq(defaultFee)
      expect(txs[1].tokenTxs.length).to.eq(1)
      expect(txs[1].tokenTxs[0].tokenIn).to.eq(usdc.address)
      expect(txs[1].tokenTxs[0].tokenOut).to.eq(weth.address)
      expect(txs[1].tokenTxs[0].amountIn).to.eq(dcaAmount.mul(9995).div(10000))
      expect(txs[1].tokenTxs[0].amountOut).to.eq(wethDifference2)
      expect(txs[1].tokenTxs[0].err).to.eq('')

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
        alice.address,
        usdc.address,
        [
          {
            token: weth.address,
            weight: 2000,
            maxSlippage: defaultSlippage,
          },
          {
            token: wbtc.address,
            weight: 8000,
            maxSlippage: defaultSlippage,
          },
        ],
        defaultDCA,
        defaultInterval,
        defaultGasPrice,
        true,
        false,
      )

      const wethPrice = (await oracle.getPriceUsdc(weth.address)).price
      const wbtcPrice = (await oracle.getPriceUsdc(wbtc.address)).price
      const outPrices = [wethPrice, wbtcPrice]

      const wethBalanceBefore = await weth.balanceOf(alice.address)
      const wbtcBalanceBefore = await wbtc.balanceOf(alice.address)

      const tx = await involica
        .connect(opsSigner)
        .executeDCA(alice.address, 1e6, [wethSwapRoute, btcSwapRoute], [0, 0], outPrices)

      const wethBalanceAfter = await weth.balanceOf(alice.address)
      const wbtcBalanceAfter = await wbtc.balanceOf(alice.address)

      // TEST TX RECEIPTS
      const txs = await involica.fetchUserTxs(alice.address)
      expect(txs.length).to.eq(1)

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
        .withArgs(
          alice.address,
          alice.address,
          usdc.address,
          1e6,
          amountSwapped,
          outTokens,
          outBalances,
          outPrices,
          txFee,
        )
    })
    it('Partial executed swaps should be correct', async function () {
      await involica.connect(alice).setPosition(
        alice.address,
        usdc.address,
        [
          {
            token: weth.address,
            weight: 2000,
            maxSlippage: defaultSlippage,
          },
          {
            token: wbtc.address,
            weight: 8000,
            maxSlippage: defaultSlippage,
          },
        ],
        defaultDCA,
        defaultInterval,
        defaultGasPrice,
        true,
        false,
      )

      const balanceInBefore = await usdc.balanceOf(alice.address)
      const wethBalanceBefore = await weth.balanceOf(alice.address)

      await involica
        .connect(opsSigner)
        .executeDCA(alice.address, 1e6, [wethSwapRoute, btcSwapRoute], [0, parseEther('10000000000000')], [0, 0])

      const balanceInAfter = await usdc.balanceOf(alice.address)
      const wethBalanceAfter = await weth.balanceOf(alice.address)

      // Partial DCA amount used
      expect(balanceInBefore.sub(balanceInAfter)).to.eq(defaultDCA.mul(2000).div(10000))

      // TEST TX RECEIPTS
      const txs = await involica.fetchUserTxs(alice.address)
      expect(txs.length).to.eq(1)

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

      await involica.connect(opsSigner).executeDCA(alice.address, 1e6, [wethSwapRoute], [0], [0])

      const treasuryAfter = await usdc.balanceOf(deployer.address)

      expect(treasuryAfter.sub(treasuryBefore)).to.be.eq(defaultFee)
    })
    it('swap should decrease approved amount', async () => {
      await usdc.connect(alice).approve(involica.address, defaultDCA.mul(2))

      const approvedBefore = await usdc.allowance(alice.address, involica.address)

      await involica.connect(opsSigner).executeDCA(alice.address, 1e6, [wethSwapRoute], [0], [0])

      const approvedAfter = await usdc.allowance(alice.address, involica.address)

      expect(approvedBefore.sub(approvedAfter)).to.be.eq(defaultDCA)
    })
    it('swap should decrease approved amount even if swap fails', async () => {
      await usdc.connect(alice).approve(involica.address, defaultDCA.mul(2))

      const approvedBefore = await usdc.allowance(alice.address, involica.address)

      await involica
        .connect(opsSigner)
        .executeDCA(alice.address, 1e6, [wethSwapRoute], [parseEther('10000000000000')], [0])

      const approvedAfter = await usdc.allowance(alice.address, involica.address)
      const position = (await fetcher.fetchUserData(alice.address)).position

      expect(approvedBefore.sub(approvedAfter)).to.be.eq(position.amountDCA)
    })
    it('Should return unused in token if swaps partially fail', async function () {
      await involica.connect(alice).setPosition(
        alice.address,
        usdc.address,
        [
          {
            token: weth.address,
            weight: 2000,
            maxSlippage: defaultSlippage,
          },
          {
            token: wbtc.address,
            weight: 8000,
            maxSlippage: defaultSlippage,
          },
        ],
        defaultDCA,
        defaultInterval,
        defaultGasPrice,
        true,
        false,
      )

      const balanceInBefore = await usdc.balanceOf(alice.address)
      const wethBalanceBefore = await weth.balanceOf(alice.address)

      await involica
        .connect(opsSigner)
        .executeDCA(alice.address, 1e6, [wethSwapRoute, btcSwapRoute], [0, parseEther('10000000000000')], [0, 0])

      const balanceInAfter = await usdc.balanceOf(alice.address)
      const wethBalanceAfter = await weth.balanceOf(alice.address)

      // Partial DCA amount used
      expect(balanceInBefore.sub(balanceInAfter)).to.eq(defaultDCA.mul(2000).div(10000))

      // TEST TX RECEIPTS
      const txs = await involica.fetchUserTxs(alice.address)
      expect(txs.length).to.eq(1)

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
    it('Position with recipient should be created correctly', async function () {
      await involica.connect(alice).setPosition(
        bob.address,
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
        false,
      )

      const { recipient } = (await fetcher.fetchUserData(alice.address)).position
      expect(recipient).to.eq(bob.address)
    })
    it('Position with zeroAddress recipient should use msg.sender correctly', async function () {
      await involica.connect(alice).setPosition(
        ethers.constants.AddressZero,
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
        false,
      )

      const { recipient } = (await fetcher.fetchUserData(alice.address)).position
      expect(recipient).to.eq(alice.address)
    })
    it('Execute DCA with recipient should send outs to recipient', async () => {
      await involica.connect(alice).setPosition(
        bob.address,
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
        false,
      )

      const dcaAmount = (await fetcher.fetchUserData(alice.address)).position.amountDCA
      const bobWethBefore = await weth.balanceOf(bob.address)

      const uniRouter = await ethers.getContractAt('IUniswapV2Router', ROUTER_ADDRESS[chainId])
      const swapAmounts1 = await uniRouter.getAmountsOut(dcaAmount.mul(9995).div(10000), [usdc.address, weth.address])

      await expect(involica.connect(opsSigner).executeDCA(alice.address, 1e6, [wethSwapRoute], [0], [0])).to.emit(
        involica,
        'FinalizeDCA',
      )

      const bobWethAfter = await weth.balanceOf(bob.address)

      const bobWethDiff = bobWethAfter.sub(bobWethBefore)
      expect(bobWethDiff).to.be.gte(swapAmounts1[1])
    })
  })

  describe('createAndFundPosition()', async () => {
    it('createAndFundPosition() must have non-zero msg.value', async () => {
      await expect(
        involica.connect(alice).createAndFundPosition(
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
          { value: 0 },
        ),
      ).to.be.revertedWith('Treasury must not be 0')
    })
    it('createAndFundPosition() user must not already have a position', async () => {
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
        false,
      )

      await expect(
        involica.connect(alice).createAndFundPosition(
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
          { value: defaultTreasuryFund },
        ),
      ).to.be.revertedWith('User already has a position')
    })
    it('createAndFundPosition() should succeed after exit position', async () => {
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
        false,
      )

      await involica.connect(alice).exitPosition()

      const tx = await involica.connect(alice).createAndFundPosition(
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
        { value: defaultTreasuryFund },
      )
      expect(tx).to.emit(involica, 'SetPosition')
      expect(tx).to.emit(involica, 'DepositTreasury')
    })
    it('createAndFundPosition() should set values correctly', async () => {
      await involica.connect(alice).createAndFundPosition(
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
        { value: defaultTreasuryFund },
      )

      const { position, userTreasury } = await fetcher.fetchUserData(alice.address)

      expect(userTreasury).to.eq(defaultTreasuryFund)
      expect(position.user).to.eq(alice.address)
      expect(position.tokenIn).to.eq(usdc.address)
      expect(position.outs.length).to.eq(1)
      expect(position.outs[0].token).to.eq(weth.address)
      expect(position.amountDCA).to.eq(defaultDCA)
      expect(position.intervalDCA).to.eq(defaultInterval)
      expect(position.maxGasPrice).to.eq(defaultGasPrice)
    })
  })

  describe('manualExecutionOnly', async () => {
    beforeEach(async () => {
      if ((await fetcher.fetchUserData(alice.address)).userHasPosition) {
        await involica.connect(alice).exitPosition()
      }
    })

    it('setPosition() manual should not require a treasury', async () => {
      await expect(
        involica.connect(alice).setPosition(
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
          true,
        ),
      ).to.not.be.revertedWith('Treasury must not be 0')
    })
    it('setPosition() with manual position should not require an allowance, or balance', async () => {
      await expect(
        involica.connect(alice).setPosition(
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
          true,
        ),
      ).to.emit(involica, 'SetPosition')
    })
    it('setPosition() to update from auto to manual should clear task', async () => {
      await involica.connect(alice).createAndFundPosition(
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
        { value: defaultTreasuryFund },
      )

      const { taskId: taskIdInit, lastDCA: lastDCAInit } = (await fetcher.fetchUserData(alice.address)).position
      expect(taskIdInit).to.not.eq(emptyBytes32)
      expect(lastDCAInit).to.be.gt(0)

      const tx = await involica.connect(alice).setPosition(
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
        true,
      )

      expect(tx).to.emit(involica, 'ClearTask')

      const { taskId: taskIdFinal, lastDCA: lastDCAFinal } = (await fetcher.fetchUserData(alice.address)).position
      expect(taskIdFinal).to.eq(emptyBytes32)
      expect(lastDCAFinal).to.eq(0)
    })
    it('setPosition() to update from manual to auto should create task', async () => {
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
        true,
      )

      const taskIdInit = (await fetcher.fetchUserData(alice.address)).position.taskId
      expect(taskIdInit).to.eq(emptyBytes32)

      await involica.connect(alice).depositTreasury({ value: defaultTreasuryFund })
      const tx = await involica.connect(alice).setPosition(
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
        false,
      )

      expect(tx).to.emit(involica, 'InitializeTask')

      const taskIdFinal = (await fetcher.fetchUserData(alice.address)).position.taskId
      expect(taskIdFinal).to.not.eq(emptyBytes32)
    })
  })

  describe('Gas Tests', async () => {
    it('setPosition() and executeDCA() with min tokens', async () => {
      await involica.connect(alice).depositTreasury({ value: defaultTreasuryFund })
      await expect(
        involica.connect(alice).setPosition(
          alice.address,
          usdc.address,
          [
            {
              token: wbtc.address,
              weight: 10000,
              maxSlippage: defaultSlippage,
            },
          ],
          defaultDCA,
          defaultInterval,
          defaultGasPrice,
          true,
          false,
        ),
      ).to.emit(involica, 'SetPosition')

      const tx = await involica.connect(opsSigner).executeDCA(alice.address, 1e6, [btcSwapRoute], [0], [0])
      const receipt = await tx.wait()
      // eslint-disable-next-line no-console
      console.log({
        gasUsed1token: receipt.gasUsed,
      })
    })
    it('setPosition() and executeDCA() with max tokens', async () => {
      await involica.connect(alice).depositTreasury({ value: defaultTreasuryFund })
      await expect(
        involica.connect(alice).setPosition(
          alice.address,
          usdc.address,
          [
            ...new Array(7).fill({
              token: wbtc.address,
              weight: 1000,
              maxSlippage: defaultSlippage,
            }),
            {
              token: wbtc.address,
              weight: 3000,
              maxSlippage: defaultSlippage,
            },
          ],
          defaultDCA,
          defaultInterval,
          defaultGasPrice,
          true,
          false,
        ),
      ).to.emit(involica, 'SetPosition')

      const tx = await involica
        .connect(opsSigner)
        .executeDCA(
          alice.address,
          1e6,
          [
            btcSwapRoute,
            btcSwapRoute,
            btcSwapRoute,
            btcSwapRoute,
            btcSwapRoute,
            btcSwapRoute,
            btcSwapRoute,
            btcSwapRoute,
          ],
          [0, 0, 0, 0, 0, 0, 0, 0],
          [0, 0, 0, 0, 0, 0, 0, 0],
        )
      const receipt = await tx.wait()
      // eslint-disable-next-line no-console
      console.log({
        gasUsed8tokens: receipt.gasUsed,
      })
    })
  })
})
