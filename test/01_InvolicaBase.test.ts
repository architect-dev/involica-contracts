import { ethers, network } from 'hardhat'
import { Involica, Involica__factory, IERC20 } from '../typechain'

import chai from 'chai'
import { solidity } from 'ethereum-waffle'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { OPS_ADDRESS, ROUTER_ADDRESS, USDC_ADDRESS, USDC_DECIMALS, WBTC_ADDRESS, WETH_ADDRESS } from '../constants'
import { BigNumber } from '@ethersproject/bignumber'
import { mintUsdc } from './utils'
import { parseEther, parseUnits } from '@ethersproject/units'

const { expect } = chai
chai.use(solidity)

describe('Involica Base', function () {
  let deployer: SignerWithAddress
  let alice: SignerWithAddress

  let ops: SignerWithAddress

  let involica: Involica

  let usdc: IERC20
  let weth: IERC20
  let wbtc: IERC20

  let defaultTreasuryFund: BigNumber
  let defaultFund: BigNumber
  let defaultSlippage: BigNumber

  let snapshotId: string
  const chainId = 250

  before('setup contracts', async () => {
    ;[deployer, alice] = await ethers.getSigners()

    usdc = <IERC20>await ethers.getContractAt('IERC20', USDC_ADDRESS[chainId])
    weth = <IERC20>await ethers.getContractAt('IERC20', WETH_ADDRESS[chainId])
    wbtc = <IERC20>await ethers.getContractAt('IERC20', WBTC_ADDRESS[chainId])

    defaultTreasuryFund = parseEther('0.5')
    defaultFund = parseUnits('10000', USDC_DECIMALS)

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
        'Pausable: paused',
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

  describe('setAllowedPairs()', async () => {
    it('should revert if sender is not owner', async () => {
      await expect(involica.connect(alice).setAllowedTokens([usdc.address], [false])).to.be.revertedWith(
        'Ownable: caller is not the owner',
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
