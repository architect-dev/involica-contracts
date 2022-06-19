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
import { fastForwardTo, getCurrentTimestamp, mintUsdc, setAllowedToken, setBlacklistedPair, parseGwei } from './utils'
import { parseEther, parseUnits } from '@ethersproject/units'

const { expect } = chai
chai.use(solidity)

describe('Involica', function () {
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

	describe('depositTreasury()', async () => {
		it('System must not be paused', async function () {
			await involica.setPaused(true)
			expect(involica.connect(alice).depositTreasury({ value: defaultTreasuryFund })).to.be.revertedWith(
				'Pausable: paused'
			)
		})
		it('deposit of 0 should fail', async function () {
			expect(involica.connect(alice).depositTreasury({ value: 0 })).to.be.revertedWith('msg.value must be > 0')
		})
		it('should deposit to treasury successfully', async function () {
			const userTreasuryBefore = (await involica.fetchUserData(alice.address)).userTreasury

			const tx = await involica.connect(alice).depositTreasury({ value: defaultTreasuryFund })

			const userTreasuryAfter = (await involica.fetchUserData(alice.address)).userTreasury

			expect(tx).to.emit(involica, 'DepositTreasury').withArgs(alice.address, defaultTreasuryFund)
			expect(tx).to.changeEtherBalance(involica, defaultTreasuryFund)
			expect(tx).to.changeEtherBalance(alice, defaultTreasuryFund.mul(-1))
			expect(userTreasuryAfter.sub(userTreasuryBefore)).to.equal(defaultTreasuryFund)
		})
	})

	describe('withdrawTreasury()', async () => {
		beforeEach(async () => {
			await involica.connect(alice).depositTreasury({ value: defaultTreasuryFund })
		})

		it('Should not revert if system is paused', async function () {
			await involica.setPaused(true)
			expect(involica.connect(alice).withdrawTreasury(defaultTreasuryFund)).to.not.be.reverted
		})
		it('withdraw of 0 should fail', async function () {
			expect(involica.connect(alice).withdrawTreasury(0)).to.be.revertedWith('_amount must be > 0')
		})
		it('too large a withdrawal should fail', async function () {
			expect(involica.connect(alice).withdrawTreasury(defaultTreasuryFund.mul(2))).to.be.revertedWith('Bad withdraw')
		})
		it('should withdraw from treasury successfully', async function () {
			const userTreasuryBefore = (await involica.fetchUserData(alice.address)).userTreasury

			const tx = await involica.connect(alice).withdrawTreasury(defaultTreasuryFund)

			const userTreasuryAfter = (await involica.fetchUserData(alice.address)).userTreasury

			expect(tx).to.emit(involica, 'WithdrawTreasury').withArgs(alice.address, defaultTreasuryFund)
			expect(tx).to.changeEtherBalance(involica, defaultTreasuryFund.mul(-1))
			expect(tx).to.changeEtherBalance(alice, defaultTreasuryFund)
			expect(userTreasuryBefore.sub(userTreasuryAfter)).to.equal(defaultTreasuryFund)
		})
	})

	describe('setPosition()', async () => {
		beforeEach(async () => {
			await involica.connect(alice).depositTreasury({ value: defaultTreasuryFund })
		})
		it('should revert if system is paused', async () => {
			await involica.connect(deployer).setPaused(true)
			await expect(
				involica.connect(alice).setPosition(
					false,
					usdc.address,
					[
						{
							token: weth.address,
							weight: 10000,
							route: wethSwapRoute,
							maxSlippage: defaultSlippage,
						},
					],
					defaultFund,
					defaultDCA,
					defaultInterval,
					defaultGasPrice
				)
			).to.be.revertedWith('Pausable: paused')
		})
		it('should revert if treasury fund amount is 0', async () => {
			await involica.connect(alice).withdrawTreasury(defaultTreasuryFund)

			await expect(
				involica.connect(alice).setPosition(
					false,
					usdc.address,
					[
						{
							token: weth.address,
							weight: 10000,
							route: wethSwapRoute,
							maxSlippage: defaultSlippage,
						},
					],
					defaultFund,
					defaultDCA,
					defaultInterval,
					defaultGasPrice
				)
			).to.be.revertedWith('Treasury must not be 0')
		})
		it('should revert if token is not allowed', async () => {
			await setAllowedToken(involica, usdc.address, false)
			await expect(
				involica.connect(alice).setPosition(
					false,
					usdc.address,
					[
						{
							token: weth.address,
							weight: 10000,
							route: wethSwapRoute,
							maxSlippage: defaultSlippage,
						},
					],
					defaultFund,
					defaultDCA,
					defaultInterval,
					defaultGasPrice
				)
			).to.be.revertedWith('Token is not allowed')
		})
		it('should revert if value > 0 for non native token deposit', async () => {
			await setAllowedToken(involica, usdc.address, false)
			await expect(
				involica.connect(alice).setPosition(
					false,
					usdc.address,
					[
						{
							token: weth.address,
							weight: 10000,
							route: wethSwapRoute,
							maxSlippage: defaultSlippage,
						},
					],
					defaultFund,
					defaultDCA,
					defaultInterval,
					defaultGasPrice,
					{ value: defaultFund }
				)
			).to.be.revertedWith('Not native token deposit')
		})
		it('should revert if token pair is blacklisted', async () => {
			await setBlacklistedPair(involica, wethSwapRoute, true)
			await expect(
				involica.connect(alice).setPosition(
					false,
					usdc.address,
					[
						{
							token: weth.address,
							weight: 10000,
							route: wethSwapRoute,
							maxSlippage: defaultSlippage,
						},
					],
					defaultFund,
					defaultDCA,
					defaultInterval,
					defaultGasPrice
				)
			).to.be.revertedWith('Pair is blacklisted')
		})
		it('should revert if in and out tokens match', async () => {
			// IN AND OUT TOKENS MATCH
			await expect(
				involica.connect(alice).setPosition(
					false,
					usdc.address,
					[
						{
							token: usdc.address,
							weight: 10000,
							route: [usdc.address, usdc.address],
							maxSlippage: defaultSlippage,
						},
					],
					defaultFund,
					defaultDCA,
					defaultInterval,
					defaultGasPrice
				)
			).to.be.revertedWith('Same token both sides of pair')
		})
		it('should revert if weights are invalid', async () => {
			// INCORRECT WEIGHTS
			await expect(
				involica.connect(alice).setPosition(
					false,
					usdc.address,
					[
						{
							token: weth.address,
							weight: 9000,
							route: wethSwapRoute,
							maxSlippage: defaultSlippage,
						},
					],
					defaultFund,
					defaultDCA,
					defaultInterval,
					defaultGasPrice
				)
			).to.be.revertedWith('Weights do not sum to 10000')

			// NON ZERO WEIGHTS
			await expect(
				involica.connect(alice).setPosition(
					false,
					usdc.address,
					[
						{
							token: weth.address,
							weight: 0,
							route: wethSwapRoute,
							maxSlippage: defaultSlippage,
						},
					],
					defaultFund,
					defaultDCA,
					defaultInterval,
					defaultGasPrice
				)
			).to.be.revertedWith('Non zero weight')
		})
		it('should revert if in funds are 0', async () => {
			// INSUFFICIENT ERC20 DEPOSIT
			await expect(
				involica.connect(alice).setPosition(
					false,
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
					defaultDCA,
					defaultInterval,
					defaultGasPrice
				)
			).to.be.revertedWith('Deposit for at least 1 DCA')

			// INSUFFICIENT ETH DEPOSIT
			await expect(
				involica.connect(alice).setPosition(
					false,
					ETH_TOKEN_ADDRESS,
					[
						{
							token: usdc.address,
							weight: 10000,
							route: [weth.address, usdc.address],
							maxSlippage: defaultSlippage,
						},
					],
					0,
					defaultDCA,
					defaultInterval,
					defaultGasPrice,
					{ value: 0 }
				)
			).to.be.revertedWith('Deposit for at least 1 DCA')
		})
		it('should revert if DCA amount is 0', async () => {
			await expect(
				involica.connect(alice).setPosition(
					false,
					usdc.address,
					[
						{
							token: weth.address,
							weight: 10000,
							route: wethSwapRoute,
							maxSlippage: defaultSlippage,
						},
					],
					defaultFund,
					0,
					defaultInterval,
					defaultGasPrice
				)
			).to.be.revertedWith('DCA amount must be > 0')
		})
		it('should revert if route is invalid', async function () {
			await expect(
				involica.connect(alice).setPosition(
					false,
					usdc.address,
					[
						{
							token: weth.address,
							weight: 10000,
							route: [usdc.address, usdc.address, weth.address],
							maxSlippage: defaultSlippage,
						},
					],
					defaultFund,
					defaultDCA,
					defaultInterval,
					defaultGasPrice
				)
			).to.be.revertedWith('Invalid route')
		})
		it('should revert if interval is less than one minute', async () => {
			await expect(
				involica.connect(alice).setPosition(
					false,
					usdc.address,
					[
						{
							token: weth.address,
							weight: 10000,
							route: wethSwapRoute,
							maxSlippage: defaultSlippage,
						},
					],
					defaultFund,
					defaultDCA,
					30,
					defaultGasPrice
				)
			).to.be.revertedWith('DCA interval must be > 60s')
		})
		it('user should be added to usersWithPositions when position added', async () => {
			const userHasPositionBefore = (await involica.fetchUserData(alice.address)).userHasPosition
			expect(userHasPositionBefore).to.be.false

			await involica.connect(alice).setPosition(
				false,
				usdc.address,
				[
					{
						token: weth.address,
						weight: 10000,
						route: wethSwapRoute,
						maxSlippage: defaultSlippage,
					},
				],
				defaultFund,
				defaultDCA,
				defaultInterval,
				defaultGasPrice
			)

			const userHasPositionAfter = (await involica.fetchUserData(alice.address)).userHasPosition
			expect(userHasPositionAfter).to.be.true
		})
		it('should create position and deposit ETH fund', async () => {
			const balanceContractBefore = await weth.balanceOf(involica.address)

			const tx = await involica.connect(alice).setPosition(
				false,
				ETH_TOKEN_ADDRESS,
				[
					{
						token: usdc.address,
						weight: 10000,
						route: [weth.address, usdc.address],
						maxSlippage: defaultSlippage,
					},
				],
				0,
				defaultEtherDCA,
				defaultInterval,
				defaultGasPrice,
				{ value: defaultEtherFund }
			)

			expect(tx).to.emit(involica, 'Deposit').withArgs(alice.address, weth.address, defaultEtherFund)
			expect(tx).to.changeEtherBalance(alice, defaultEtherFund.mul(-1))

			const balanceContractAfter = await weth.balanceOf(involica.address)

			expect(balanceContractAfter.sub(balanceContractBefore)).to.be.eq(defaultEtherFund)

			const position = (await involica.fetchUserData(alice.address)).position
			expect(position.user).to.be.eq(alice.address)
			expect(position.tokenIn).to.be.eq(weth.address)
			expect(position.outs.length).to.be.eq(1)
			expect(position.outs[0].token).to.be.eq(usdc.address)
			expect(position.outs[0].weight).to.be.eq(10000)
			expect(position.outs[0].maxSlippage).to.be.eq(defaultSlippage)
			expect(position.outs[0].balance).to.be.eq(0)
			expect(position.balanceIn).to.be.eq(defaultEtherFund)
			expect(position.amountDCA).to.be.eq(defaultEtherDCA)
			expect(position.intervalDCA).to.be.eq(defaultInterval)
			expect(position.maxGasPrice).to.be.eq(parseGwei(defaultGasPrice))
			expect(position.lastDCA).to.be.eq(0)
			expect(position.taskId).to.exist
			expect(position.finalizationReason).to.equal('')
		})
		it('should create position and deposit fund', async () => {
			const balanceAliceBefore = await usdc.balanceOf(alice.address)
			const balanceContractBefore = await usdc.balanceOf(involica.address)

			const tx = await involica.connect(alice).setPosition(
				false,
				usdc.address,
				[
					{
						token: weth.address,
						weight: 10000,
						route: wethSwapRoute,
						maxSlippage: defaultSlippage,
					},
				],
				defaultFund,
				defaultDCA,
				defaultInterval,
				defaultGasPrice
			)

			expect(tx).to.emit(involica, 'Deposit').withArgs(alice.address, usdc.address, defaultFund)

			const balanceAliceAfter = await usdc.balanceOf(alice.address)
			const balanceContractAfter = await usdc.balanceOf(involica.address)

			expect(balanceAliceBefore.sub(balanceAliceAfter)).to.be.eq(defaultFund)
			expect(balanceContractAfter.sub(balanceContractBefore)).to.be.eq(defaultFund)

			const position = (await involica.fetchUserData(alice.address)).position
			expect(position.user).to.be.eq(alice.address)
			expect(position.tokenIn).to.be.eq(usdc.address)
			expect(position.outs.length).to.be.eq(1)
			expect(position.outs[0].token).to.be.eq(weth.address)
			expect(position.outs[0].weight).to.be.eq(10000)
			expect(position.outs[0].maxSlippage).to.be.eq(defaultSlippage)
			expect(position.outs[0].balance).to.be.eq(0)
			expect(position.balanceIn).to.be.eq(defaultFund)
			expect(position.amountDCA).to.be.eq(defaultDCA)
			expect(position.intervalDCA).to.be.eq(defaultInterval)
			expect(position.maxGasPrice).to.be.eq(parseGwei(defaultGasPrice))
			expect(position.lastDCA).to.be.eq(0)
			expect(position.taskId).to.exist
			expect(position.finalizationReason).to.equal('')
		})
		it('should clear existing position and deposit fund', async () => {
			// Initial portfolio of wETH
			await involica.connect(alice).setPosition(
				false,
				ETH_TOKEN_ADDRESS,
				[
					{
						token: usdc.address,
						weight: 10000,
						route: [weth.address, usdc.address],
						maxSlippage: defaultSlippage,
					},
				],
				0,
				defaultEtherDCA,
				defaultInterval,
				defaultGasPrice,
				{ value: defaultEtherFund }
			)

			const usdcAliceBefore = await usdc.balanceOf(alice.address)
			const usdcContractBefore = await usdc.balanceOf(involica.address)
			const wethContractBefore = await weth.balanceOf(involica.address)

			// Update portfolio to wBTC
			const txDCA = defaultDCA.mul(2)
			const txInterval = BigNumber.from(defaultInterval).mul(2)
			const txSlippage = defaultSlippage.mul(2)
			const txGasPrice = BigNumber.from(defaultGasPrice).mul(2)
			const tx = await involica.connect(alice).setPosition(
				false,
				usdc.address,
				[
					{
						token: wbtc.address,
						weight: 10000,
						route: btcSwapRoute,
						maxSlippage: txSlippage,
					},
				],
				defaultFund,
				txDCA,
				txInterval,
				txGasPrice
			)

			const usdcAliceAfter = await usdc.balanceOf(alice.address)
			const usdcContractAfter = await usdc.balanceOf(involica.address)
			const wethContractAfter = await weth.balanceOf(involica.address)

			// wETH should be removed from contract (converted to ETH on withdraw)
			expect(wethContractBefore.sub(wethContractAfter)).to.be.equal(defaultEtherFund)
			// ETH deposited should be returned from involica to alice (in tokens differ)
			expect(tx).to.changeEtherBalance(alice, defaultEtherFund)

			expect(usdcAliceBefore.sub(usdcAliceAfter)).to.be.eq(defaultFund)
			expect(usdcContractAfter.sub(usdcContractBefore)).to.be.eq(defaultFund)

			const position = (await involica.fetchUserData(alice.address)).position
			expect(position.user).to.be.eq(alice.address)
			expect(position.tokenIn).to.be.eq(usdc.address)
			expect(position.outs.length).to.be.eq(1)
			expect(position.outs[0].token).to.be.eq(wbtc.address)
			expect(position.outs[0].weight).to.be.eq(10000)
			expect(position.outs[0].maxSlippage).to.be.eq(txSlippage)
			expect(position.outs[0].balance).to.be.eq(0)
			expect(position.balanceIn).to.be.eq(defaultFund)
			expect(position.amountDCA).to.be.eq(txDCA)
			expect(position.intervalDCA).to.be.eq(txInterval)
			expect(position.maxGasPrice).to.be.eq(parseGwei(txGasPrice))
			expect(position.lastDCA).to.be.eq(0)
			expect(position.taskId).to.exist
			expect(position.finalizationReason).to.equal('')
		})
	})

	describe('setPosition() multiple out tokens', async () => {
		it('multiple out tokens with invalid weights should fail', async () => {
			await involica.connect(alice).depositTreasury({ value: defaultTreasuryFund })

			await expect(
				involica.connect(alice).setPosition(
					false,
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
					defaultFund,
					defaultDCA,
					defaultInterval,
					defaultGasPrice
				)
			).to.be.revertedWith('Weights do not sum to 10000')
		})
		it('should create position with 2 out tokens', async () => {
			await involica.connect(alice).depositTreasury({ value: defaultTreasuryFund })

			const balanceAliceBefore = await usdc.balanceOf(alice.address)
			const balanceContractBefore = await usdc.balanceOf(involica.address)

			const tx = await involica.connect(alice).setPosition(
				false,
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
				defaultFund,
				defaultDCA,
				defaultInterval,
				defaultGasPrice
			)

			expect(tx).to.emit(involica, 'SetPosition')
			expect(tx).to.emit(involica, 'Deposit').withArgs(alice.address, usdc.address, defaultFund)
			expect(tx).to.emit(involica, 'InitializeTask')

			const balanceAliceAfter = await usdc.balanceOf(alice.address)
			const balanceContractAfter = await usdc.balanceOf(involica.address)

			expect(balanceAliceBefore.sub(balanceAliceAfter)).to.be.eq(defaultFund)
			expect(balanceContractAfter.sub(balanceContractBefore)).to.be.eq(defaultFund)

			const position = (await involica.fetchUserData(alice.address)).position
			expect(position.user).to.be.eq(alice.address)
			expect(position.tokenIn).to.be.eq(usdc.address)
			expect(position.outs.length).to.be.eq(2)
			expect(position.outs[0].token).to.be.eq(wbtc.address)
			expect(position.outs[0].weight).to.be.eq(7000)
			expect(position.outs[0].maxSlippage).to.be.eq(200)
			expect(position.outs[0].balance).to.be.eq(0)
			expect(position.outs[1].token).to.be.eq(weth.address)
			expect(position.outs[1].weight).to.be.eq(3000)
			expect(position.outs[1].maxSlippage).to.be.eq(defaultSlippage)
			expect(position.outs[1].balance).to.be.eq(0)
			expect(position.balanceIn).to.be.eq(defaultFund)
			expect(position.amountDCA).to.be.eq(defaultDCA)
			expect(position.intervalDCA).to.be.eq(defaultInterval)
			expect(position.maxGasPrice).to.be.eq(parseGwei(defaultGasPrice))
			expect(position.lastDCA).to.be.eq(0)
			expect(position.taskId).to.exist
			expect(position.finalizationReason).to.equal('')
		})
	})

	describe('depositIn()', async () => {
		beforeEach(async () => {
			await involica.connect(alice).depositTreasury({ value: defaultTreasuryFund })
			await involica.connect(bob).depositTreasury({ value: defaultTreasuryFund })

			await involica.connect(alice).setPosition(
				false,
				usdc.address,
				[
					{
						token: weth.address,
						weight: 10000,
						route: wethSwapRoute,
						maxSlippage: defaultSlippage,
					},
				],
				defaultFund,
				defaultDCA,
				defaultInterval,
				defaultGasPrice
			)
			await involica.connect(bob).setPosition(
				false,
				ETH_TOKEN_ADDRESS,
				[
					{
						token: usdc.address,
						weight: 10000,
						route: [weth.address, usdc.address],
						maxSlippage: defaultSlippage,
					},
				],
				0,
				defaultEtherDCA,
				defaultInterval,
				defaultGasPrice,
				{ value: defaultEtherFund }
			)
		})

		it('User must have position', async function () {
			expect(involica.connect(deployer).depositIn(defaultFund)).to.be.revertedWith('User doesnt have a position')
		})
		it('should revert if system is paused', async () => {
			await involica.setPaused(true)
			await expect(involica.connect(alice).depositIn(defaultFund)).to.be.revertedWith('Pausable: paused')
		})
		it('should revert if amount is 0', async () => {
			await expect(involica.connect(alice).depositIn(0)).to.be.revertedWith('_amount must be > 0')
			await expect(involica.connect(bob).depositIn(0, { value: 0 })).to.be.revertedWith('_amount must be > 0')
		})
		it('should deposit fund ERC20', async () => {
			const balanceAliceBefore = await usdc.balanceOf(alice.address)
			const balanceContractBefore = await usdc.balanceOf(involica.address)

			await expect(involica.connect(alice).depositIn(defaultFund))
				.to.emit(involica, 'Deposit')
				.withArgs(alice.address, usdc.address, defaultFund)

			const balanceAliceAfter = await usdc.balanceOf(alice.address)
			const balanceContractAfter = await usdc.balanceOf(involica.address)

			expect(balanceAliceBefore.sub(balanceAliceAfter)).to.be.eq(defaultFund)
			expect(balanceContractAfter.sub(balanceContractBefore)).to.be.eq(defaultFund)

			const position = (await involica.fetchUserData(alice.address)).position
			expect(position.balanceIn).to.be.eq(defaultFund.add(defaultFund))
		})
		it('should deposit fund ETH', async () => {
			const balanceContractBefore = await weth.balanceOf(involica.address)

			const tx = await involica.connect(bob).depositIn(0, { value: defaultEtherFund })
			expect(tx).to.emit(involica, 'Deposit').withArgs(bob.address, weth.address, defaultEtherFund)
			expect(tx).to.changeEtherBalance(bob, defaultEtherFund.mul(-1))

			const balanceContractAfter = await weth.balanceOf(involica.address)

			expect(balanceContractAfter.sub(balanceContractBefore)).to.be.eq(defaultEtherFund)

			const position = (await involica.fetchUserData(bob.address)).position
			expect(position.balanceIn).to.be.eq(defaultEtherFund.add(defaultEtherFund))
		})
	})

	describe('withdrawIn()', async () => {
		beforeEach(async () => {
			await involica.connect(alice).depositTreasury({ value: defaultTreasuryFund })
			await involica.connect(bob).depositTreasury({ value: defaultTreasuryFund })

			await involica.connect(alice).setPosition(
				false,
				usdc.address,
				[
					{
						token: weth.address,
						weight: 10000,
						route: wethSwapRoute,
						maxSlippage: defaultSlippage,
					},
				],
				defaultFund,
				defaultDCA,
				defaultInterval,
				defaultGasPrice
			)
			await involica.connect(bob).setPosition(
				false,
				ETH_TOKEN_ADDRESS,
				[
					{
						token: usdc.address,
						weight: 10000,
						route: [weth.address, usdc.address],
						maxSlippage: defaultSlippage,
					},
				],
				0,
				defaultEtherDCA,
				defaultInterval,
				defaultGasPrice,
				{ value: defaultEtherFund }
			)
		})

		it('User must have position', async function () {
			expect(involica.connect(deployer).withdrawIn(defaultFund)).to.be.revertedWith('User doesnt have a position')
		})
		it('should not revert if system is paused', async () => {
			await involica.setPaused(true)
			await expect(involica.connect(alice).withdrawIn(defaultFund)).to.not.be.reverted
		})
		it('should revert if amount is 0', async () => {
			await expect(involica.connect(alice).withdrawIn(0)).to.be.revertedWith('_amount must be > 0')
			await expect(involica.connect(bob).withdrawIn(0)).to.be.revertedWith('_amount must be > 0')
		})
		it('should withdraw fund ERC20', async () => {
			const balanceAliceBefore = await usdc.balanceOf(alice.address)
			const balanceContractBefore = await usdc.balanceOf(involica.address)

			await expect(involica.connect(alice).withdrawIn(defaultFund))
				.to.emit(involica, 'WithdrawIn')
				.withArgs(alice.address, usdc.address, defaultFund)

			const balanceAliceAfter = await usdc.balanceOf(alice.address)
			const balanceContractAfter = await usdc.balanceOf(involica.address)

			expect(balanceAliceAfter.sub(balanceAliceBefore)).to.be.eq(defaultFund)
			expect(balanceContractBefore.sub(balanceContractAfter)).to.be.eq(defaultFund)

			const position = (await involica.fetchUserData(alice.address)).position
			expect(position.balanceIn).to.be.eq(defaultFund.sub(defaultFund))
		})
		it('should withdraw fund ETH', async () => {
			const balanceContractBefore = await weth.balanceOf(involica.address)

			const tx = await involica.connect(bob).withdrawIn(defaultEtherFund)
			expect(tx).to.emit(involica, 'WithdrawIn').withArgs(bob.address, weth.address, defaultEtherFund)
			expect(tx).to.changeEtherBalance(bob, defaultEtherFund)

			const balanceContractAfter = await weth.balanceOf(involica.address)

			expect(balanceContractBefore.sub(balanceContractAfter)).to.be.eq(defaultEtherFund)

			const position = (await involica.fetchUserData(bob.address)).position
			expect(position.balanceIn).to.be.eq(defaultEtherFund.sub(defaultEtherFund))
		})
		it('should finalize position if user fully withdraws balanceIn', async function () {
			const tx = await involica.connect(alice).withdrawIn(defaultFund)

			expect(tx).to.emit(involica, 'FinalizeTask').withArgs(alice.address, 'Insufficient funds')

			const { finalizationReason, taskId } = (await involica.fetchUserData(alice.address)).position
			expect(finalizationReason).to.be.eq('Insufficient funds')
			expect(taskId).to.be.eq(emptyBytes32)
		})
		it('should finalize position if user withdraws below amountDCA', async function () {
			const tx = await involica.connect(alice).withdrawIn(defaultFund.sub(defaultDCA).add(defaultDCA.div(2)))

			expect(tx).to.emit(involica, 'FinalizeTask').withArgs(alice.address, 'Insufficient funds')

			const { finalizationReason, taskId } = (await involica.fetchUserData(alice.address)).position
			expect(finalizationReason).to.be.eq('Insufficient funds')
			expect(taskId).to.be.eq(emptyBytes32)
		})
	})

	describe('withdrawOuts()', async () => {
		beforeEach(async () => {
			await involica.connect(alice).depositTreasury({ value: defaultTreasuryFund })

			await involica.connect(alice).setPosition(
				false,
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
				defaultFund,
				defaultDCA,
				defaultInterval,
				defaultGasPrice
			)
		})

		it('should revert if position does not exist', async () => {
			await expect(involica.connect(deployer).withdrawOuts()).to.be.revertedWith('User doesnt have a position')
		})
		it('should withdraw', async () => {
			await involica.connect(ops).executeDCA(alice.address, [0, 0])

			const positionBefore = (await involica.fetchUserData(alice.address)).position
			const tokensOutWithdrawable = positionBefore.outs.map((tokenOut) => {
				expect(tokenOut.balance).to.be.gt(0)
				return tokenOut.balance
			})
			const wethWithdrawable = tokensOutWithdrawable[0]
			const wbtcWithdrawable = tokensOutWithdrawable[1]

			const wethContractBefore = await weth.balanceOf(involica.address)
			const wbtcContractBefore = await wbtc.balanceOf(involica.address)

			const tx = await involica.connect(alice).withdrawOuts()

			expect(tx).to.emit(involica, 'WithdrawOuts')
			expect(tx).to.changeEtherBalance(alice, wethWithdrawable)

			const wethContractAfter = await weth.balanceOf(involica.address)
			const wbtcContractAfter = await wbtc.balanceOf(involica.address)

			expect(wethContractBefore.sub(wethContractAfter)).to.be.eq(wethWithdrawable)
			expect(wbtcContractBefore.sub(wbtcContractAfter)).to.be.eq(wbtcWithdrawable)

			const positionAfter = (await involica.fetchUserData(alice.address)).position

			positionAfter.outs.forEach((tokenOut) => {
				expect(tokenOut.balance).to.be.eq(0)
			})
		})
		it('updating position should withdraw out tokens automatically', async () => {
			await involica.connect(ops).executeDCA(alice.address, [0, 0])

			const positionBefore = (await involica.fetchUserData(alice.address)).position
			const tokensOutWithdrawable = positionBefore.outs.map((tokenOut) => {
				expect(tokenOut.balance).to.be.gt(0)
				return tokenOut.balance
			})

			const wethWithdrawable = tokensOutWithdrawable[0]
			const wbtcWithdrawable = tokensOutWithdrawable[1]

			const wethContractBefore = await weth.balanceOf(involica.address)
			const wbtcContractBefore = await wbtc.balanceOf(involica.address)

			const tx = await involica.connect(alice).setPosition(
				false,
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
				defaultDCA,
				defaultInterval,
				defaultGasPrice
			)

			expect(tx).to.emit(involica, 'WithdrawOuts')
			expect(tx).to.changeEtherBalance(alice, wethWithdrawable)

			const wethContractAfter = await weth.balanceOf(involica.address)
			const wbtcContractAfter = await wbtc.balanceOf(involica.address)

			expect(wethContractBefore.sub(wethContractAfter)).to.be.eq(wethWithdrawable)
			expect(wbtcContractBefore.sub(wbtcContractAfter)).to.be.eq(wbtcWithdrawable)

			const positionAfter = (await involica.fetchUserData(alice.address)).position

			positionAfter.outs.forEach((tokenOut) => {
				expect(tokenOut.balance).to.be.eq(0)
			})
		})
	})

	describe('exitPosition()', async () => {
		beforeEach(async () => {
			await involica.connect(alice).depositTreasury({ value: defaultTreasuryFund })
			await involica.connect(bob).depositTreasury({ value: defaultTreasuryFund })

			await involica.connect(alice).setPosition(
				false,
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
				defaultFund,
				defaultDCA,
				defaultInterval,
				defaultGasPrice
			)
			await involica.connect(bob).setPosition(
				false,
				ETH_TOKEN_ADDRESS,
				[
					{
						token: usdc.address,
						weight: 10000,
						route: [weth.address, usdc.address],
						maxSlippage: defaultSlippage,
					},
				],
				0,
				defaultEtherDCA,
				defaultInterval,
				defaultGasPrice,
				{ value: defaultEtherFund }
			)
		})

		it('should revert if position does not exist', async () => {
			await expect(involica.connect(deployer).exitPosition()).to.be.revertedWith('User doesnt have a position')
		})
		it('should exit successfully', async () => {
			await involica.connect(ops).executeDCA(alice.address, [0, 0])

			const positionBefore = (await involica.fetchUserData(alice.address)).position
			const tokensOutWithdrawable = positionBefore.outs.map((tokenOut) => {
				expect(tokenOut.balance).to.be.gt(0)
				return tokenOut.balance
			})
			const wethWithdrawable = tokensOutWithdrawable[0]
			const wbtcWithdrawable = tokensOutWithdrawable[1]

			const usdcAliceBefore = await usdc.balanceOf(alice.address)
			const wethContractBefore = await weth.balanceOf(involica.address)
			const wbtcContractBefore = await wbtc.balanceOf(involica.address)

			const tx = await involica.connect(alice).exitPosition()

			expect(tx).to.emit(involica, 'WithdrawIn').withArgs(alice.address, usdc.address, defaultFund.sub(defaultDCA))
			expect(tx).to.emit(involica, 'WithdrawOuts')
			expect(tx).to.emit(involica, 'WithdrawTreasury').withArgs(alice.address, defaultTreasuryFund)
			expect(tx).to.emit(involica, 'FinalizeTask').withArgs(alice.address, 'User exited')

			// Should return withWithdrawable + defaultTreasuryFund
			expect(tx).to.changeEtherBalance(alice, defaultTreasuryFund.add(wethWithdrawable))

			const usdcAliceAfter = await usdc.balanceOf(alice.address)
			const wethContractAfter = await weth.balanceOf(involica.address)
			const wbtcContractAfter = await wbtc.balanceOf(involica.address)

			// Return Token In
			expect(usdcAliceAfter.sub(usdcAliceBefore)).to.be.eq(defaultFund.sub(defaultDCA))
			// Return Tokens Out
			expect(wethContractBefore.sub(wethContractAfter)).to.be.eq(wethWithdrawable)
			expect(wbtcContractBefore.sub(wbtcContractAfter)).to.be.eq(wbtcWithdrawable)

			const userHasPositionAfter = (await involica.fetchUserData(alice.address)).userHasPosition
			expect(userHasPositionAfter).to.be.false
		})
		it('should exit successfully ETH', async () => {
			await involica.connect(ops).executeDCA(bob.address, [0])

			const positionBefore = (await involica.fetchUserData(bob.address)).position
			const tokensOutWithdrawable = positionBefore.outs.map((tokenOut) => {
				expect(tokenOut.balance).to.be.gt(0)
				return tokenOut.balance
			})
			const usdcWithdrawable = tokensOutWithdrawable[0]

			const usdcContractBefore = await usdc.balanceOf(involica.address)
			const wethContractBefore = await weth.balanceOf(involica.address)

			const tx = await involica.connect(bob).exitPosition()

			expect(tx)
				.to.emit(involica, 'WithdrawIn')
				.withArgs(bob.address, weth.address, defaultEtherFund.sub(defaultEtherDCA))
			expect(tx).to.emit(involica, 'WithdrawOuts')
			expect(tx).to.emit(involica, 'WithdrawTreasury').withArgs(bob.address, defaultTreasuryFund)
			expect(tx).to.emit(involica, 'FinalizeTask').withArgs(bob.address, 'User exited')

			// Should return default fund - dca amount + defaultTreasuryFund
			expect(tx).to.changeEtherBalance(bob, defaultEtherFund.sub(defaultEtherDCA).add(defaultTreasuryFund))

			const usdcContractAfter = await usdc.balanceOf(involica.address)
			const wethContractAfter = await weth.balanceOf(involica.address)

			// Return Token In
			expect(wethContractBefore.sub(wethContractAfter)).to.be.eq(defaultEtherFund.sub(defaultEtherDCA))
			// Return Tokens Out
			expect(usdcContractBefore.sub(usdcContractAfter)).to.be.eq(usdcWithdrawable)

			const userHasPositionAfter = (await involica.fetchUserData(bob.address)).userHasPosition
			expect(userHasPositionAfter).to.be.false
		})
		it('functions requiring position should fail after exit', async function () {
			await involica.connect(alice).exitPosition()
			await expect(involica.connect(alice).depositIn(defaultEtherFund)).to.be.revertedWith(
				'User doesnt have a position'
			)
		})
	})

	describe('executeDCA()', async () => {
		beforeEach(async () => {
			await involica.connect(alice).depositTreasury({ value: defaultTreasuryFund })

			await involica.connect(alice).setPosition(
				false,
				usdc.address,
				[
					{
						token: weth.address,
						weight: 10000,
						route: wethSwapRoute,
						maxSlippage: defaultSlippage,
					},
				],
				defaultFund,
				defaultDCA,
				defaultInterval,
				defaultGasPrice
			)
		})

		it('should revert if position does not exist', async () => {
			await expect(involica.connect(ops).executeDCA(bob.address, [0])).to.be.revertedWith('User doesnt have a position')
		})
		it('should revert if sender is not ops', async () => {
			await expect(involica.connect(alice).executeDCA(alice.address, [0])).to.be.revertedWith('OpsReady: onlyOps')
		})
		it('should revert if system is paused', async () => {
			await involica.connect(deployer).setPaused(true)
			await expect(involica.connect(ops).executeDCA(alice.address, [0])).to.be.revertedWith('Pausable: paused')
		})
		it('should finalize if position has run out of funds', async () => {
			await involica.connect(alice).withdrawIn(defaultFund.sub(defaultDCA).sub(1))
			await involica.connect(ops).executeDCA(alice.address, [0])

			const lastDCA = (await involica.fetchUserData(alice.address)).position.lastDCA
			await fastForwardTo(Number(lastDCA.add(defaultInterval)))

			const tx = await involica.connect(ops).executeDCA(alice.address, [0])

			expect(tx).to.emit(involica, 'FinalizeTask').withArgs(alice.address, 'Insufficient funds')

			const { finalizationReason, taskId } = (await involica.fetchUserData(alice.address)).position
			expect(finalizationReason).to.be.eq('Insufficient funds')
			expect(taskId).to.be.eq(emptyBytes32)
		})
		it('should finalize if user treasury is out of gas')
		it('should not execute swap if swap fails', async () => {
			await involica.connect(ops).executeDCA(alice.address, [parseEther('10000000000000')])

			const position = (await involica.fetchUserData(alice.address)).position
			expect(position.outs[0].balance).to.eq(0)
		})
		it('should not decrease balanceIn if swap pails', async () => {
			const aliceBalanceInBefore = (await involica.fetchUserData(alice.address)).position.balanceIn

			await involica.connect(ops).executeDCA(alice.address, [parseEther('10000000000000')])

			const position = (await involica.fetchUserData(alice.address)).position
			const aliceBalanceInAfter = (await involica.fetchUserData(alice.address)).position.balanceIn
			expect(aliceBalanceInBefore).to.be.eq(aliceBalanceInAfter)
			expect(position.outs[0].balance).to.eq(0)
		})
		it('should not execute swap if token pair is not allowed', async () => {
			await setAllowedToken(involica, usdc.address, false)

			await involica.connect(ops).executeDCA(alice.address, [0])

			const position = (await involica.fetchUserData(alice.address)).position
			expect(position.outs[0].balance).to.eq(0)
		})
		it('should revert if extra data is invalid', async function () {
			expect(involica.connect(ops).executeDCA(alice.address, [0])).to.be.revertedWith('Invalid extra data')
		})
		it("should revert if it's not time to DCA", async () => {
			await involica.connect(ops).executeDCA(alice.address, [0])

			const currentTimestamp = await getCurrentTimestamp()
			const lastDCA = (await involica.fetchUserData(alice.address)).position.lastDCA
			expect(lastDCA).to.be.eq(currentTimestamp)

			expect(involica.connect(ops).executeDCA(alice.address, [0])).to.be.revertedWith('DCA not mature')
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
			await expect(involica.connect(ops).executeDCA(alice.address, [0]))
				.to.emit(involica, 'ExecuteDCA')
				.withArgs(alice.address)

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
		it('Position with multiple out tokens should create correct tx receipts', async function () {
			await involica.connect(alice).setPosition(
				false,
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
				0,
				defaultDCA,
				defaultInterval,
				defaultGasPrice
			)

			await involica.connect(ops).executeDCA(alice.address, [0, 0])

			const { lastDCA, outs } = (await involica.fetchUserData(alice.address)).position
			const wethBalance = outs[0].balance
			const wbtcBalance = outs[1].balance

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
			expect(txs[0].tokenTxs[1].amountIn).to.eq(defaultDCA.mul(8000).div(10000))
			expect(txs[0].tokenTxs[1].amountOut).to.eq(wbtcBalance)
			expect(txs[0].tokenTxs[1].err).to.eq('')
		})
		it('Partial executed swaps should be correct', async function () {
			await involica.connect(alice).setPosition(
				false,
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
				0,
				defaultDCA,
				defaultInterval,
				defaultGasPrice
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

	describe('setAllowedPairs()', async () => {
		it('should revert if sender is not owner', async () => {
			await expect(involica.connect(alice).setAllowedTokens([usdc.address], [false])).to.be.revertedWith(
				'Ownable: caller is not the owner'
			)
		})
		it('should set new value', async () => {
			expect((await involica.fetchAllowedTokens()).indexOf(usdc.address) > -1).to.be.eq(true)
			expect((await involica.fetchAllowedTokens()).indexOf(wbtc.address) > -1).to.be.eq(true)

			const tx = await involica.connect(deployer).setAllowedTokens([usdc.address, wbtc.address], [false, false])
			expect(tx).to.emit(involica, 'SetAllowedToken').withArgs(usdc.address, false)
			expect(tx).to.emit(involica, 'SetAllowedToken').withArgs(wbtc.address, false)

			expect((await involica.fetchAllowedTokens()).indexOf(usdc.address) > -1).to.be.eq(false)
			expect((await involica.fetchAllowedTokens()).indexOf(wbtc.address) > -1).to.be.eq(false)
		})
	})

	describe('setMinSlippage()', async () => {
		it('should revert if sender is not owner', async () => {
			await expect(involica.connect(alice).setMinSlippage(0)).to.be.revertedWith('Ownable: caller is not the owner')
		})
		it('should revert if new value is same to old value', async () => {
			await expect(involica.connect(deployer).setMinSlippage(defaultSlippage)).to.be.revertedWith('Same slippage value')
		})
		it('should revert if slippage is too large', async () => {
			await expect(involica.connect(deployer).setMinSlippage(1000000)).to.be.revertedWith('Min slippage too large')
		})
		it('should set new value', async () => {
			expect(await involica.minSlippage()).to.be.eq(defaultSlippage)
			await expect(involica.connect(deployer).setMinSlippage(defaultSlippage.add(1)))
				.to.emit(involica, 'MinSlippageSet')
				.withArgs(defaultSlippage.add(1))
			expect(await involica.minSlippage()).to.be.eq(defaultSlippage.add(1))
		})
	})

	describe('setPaused()', async () => {
		it('should revert if sender is not owner', async () => {
			await expect(involica.connect(alice).setPaused(false)).to.be.revertedWith('Ownable: caller is not the owner')
		})
		it('should set new value', async () => {
			expect(await involica.paused()).to.be.eq(false)
			await expect(involica.connect(deployer).setPaused(true)).to.emit(involica, 'Paused').withArgs(deployer.address)
			expect(await involica.paused()).to.be.eq(true)
			await expect(involica.connect(deployer).setPaused(false)).to.emit(involica, 'Unpaused').withArgs(deployer.address)
			expect(await involica.paused()).to.be.eq(false)
		})
	})
})
