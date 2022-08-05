import { ethers } from 'hardhat'
import { Involica, IERC20, InvolicaFetcher } from '../typechain'
import chai from 'chai'
import { solidity } from 'ethereum-waffle'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { BigNumber } from '@ethersproject/bignumber'
import { prepare } from './utils'

const { expect } = chai
chai.use(solidity)

describe('Involica Base', function () {
  // let chainId: number
  // let signers: SignerWithAddress[]

  let deployer: SignerWithAddress
  let alice: SignerWithAddress
  // let bob: SignerWithAddress

  // let opsSigner: SignerWithAddress
  // let gelato: SignerWithAddress
  // let opsGelatoSigner: SignerWithAddress

  let usdc: IERC20
  let weth: IERC20
  let wbtc: IERC20

  let defaultTreasuryFund: BigNumber
  // let defaultFund: BigNumber
  // let defaultDCA: BigNumber
  // let defaultFee: BigNumber
  let defaultSlippage: BigNumber
  // let defaultGasPrice: BigNumberish
  // let defaultInterval: BigNumberish
  // let defaultGelatoFee: BigNumber
  // let wethSwapRoute: string[]
  // let btcSwapRoute: string[]

  let involica: Involica
  // let resolver: InvolicaResolver
  // let oracle: Oracle
  let fetcher: InvolicaFetcher
  // let ops: IOps

  // let emptyBytes32: string
  // let aliceResolverHash: string

  let snapshotId: string

  before('setup contracts', async () => {
    ;({
      // chainId,
      // signers,
      deployer,
      alice,
      // bob,
      // opsSigner,
      // gelato,
      // opsGelatoSigner,
      usdc,
      weth,
      wbtc,
      defaultTreasuryFund,
      // defaultFund,
      // defaultDCA,
      // defaultFee,
      defaultSlippage,
      // defaultGasPrice,
      // defaultInterval,
      // defaultGelatoFee,
      // wethSwapRoute,
      // btcSwapRoute,
      involica,
      // resolver,
      // oracle,
      fetcher,
      // ops,
      // emptyBytes32,
      // aliceResolverHash,
      snapshotId,
    } = await prepare(250))
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
      const userTreasuryBefore = (await fetcher.fetchUserData(alice.address)).userTreasury

      const tx = await involica.connect(alice).depositTreasury({ value: defaultTreasuryFund })

      const userTreasuryAfter = (await fetcher.fetchUserData(alice.address)).userTreasury

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
      const userTreasuryBefore = (await fetcher.fetchUserData(alice.address)).userTreasury

      const tx = await involica.connect(alice).withdrawTreasury(defaultTreasuryFund)

      const userTreasuryAfter = (await fetcher.fetchUserData(alice.address)).userTreasury

      expect(tx).to.emit(involica, 'WithdrawTreasury').withArgs(alice.address, defaultTreasuryFund)
      expect(tx).to.changeEtherBalance(involica, defaultTreasuryFund.mul(-1))
      expect(tx).to.changeEtherBalance(alice, defaultTreasuryFund)
      expect(userTreasuryBefore.sub(userTreasuryAfter)).to.equal(defaultTreasuryFund)
    })
  })

  describe('setAllowedTokens()', async () => {
    it('should revert if sender is not owner', async () => {
      await expect(involica.connect(alice).setAllowedTokens([usdc.address], [false])).to.be.revertedWith(
        'Ownable: caller is not the owner',
      )
    })
    it('should revert if argument array lengths dont match', async () => {
      await expect(involica.connect(deployer).setAllowedTokens([usdc.address], [])).to.be.revertedWith('Invalid length')
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

  describe('setBlacklistedPairs()', async () => {
    it('should revert if sender is not owner', async () => {
      await expect(
        involica.connect(alice).setBlacklistedPairs([usdc.address, weth.address], [true]),
      ).to.be.revertedWith('Ownable: caller is not the owner')
    })
    it('should revert if argument array lengths dont match', async () => {
      await expect(involica.connect(deployer).setBlacklistedPairs([usdc.address], [true])).to.be.revertedWith(
        'Invalid length',
      )
    })
    it('should set new value', async () => {
      const blacklistedInit = await involica.blacklistedPairs(usdc.address, weth.address)
      expect(blacklistedInit).to.be.false

      const tx = await involica.connect(deployer).setBlacklistedPairs([usdc.address, weth.address], [true])
      expect(tx).to.emit(involica, 'SetBlacklistedPair').withArgs(usdc.address, weth.address, true)

      const blacklistedFinal = await involica.blacklistedPairs(usdc.address, weth.address)
      expect(blacklistedFinal).to.be.true
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

  describe('setInvolicaTreasury()', async () => {
    it('should revert if sender is not owner', async () => {
      await expect(involica.connect(alice).setInvolicaTreasury(alice.address)).to.be.revertedWith(
        'Ownable: caller is not the owner',
      )
    })
    it('should revert if invalid resolver set', async () => {
      await expect(involica.connect(deployer).setInvolicaTreasury(ethers.constants.AddressZero)).to.be.revertedWith(
        'Missing treasury',
      )
    })
    it('should set new value', async () => {
      await expect(involica.connect(deployer).setInvolicaTreasury(alice.address))
        .to.emit(involica, 'SetInvolicaTreasury')
        .withArgs(alice.address)
      expect(await involica.involicaTreasury()).to.be.eq(alice.address)
    })
  })

  describe('setInvolicaTxFee()', async () => {
    it('should revert if sender is not owner', async () => {
      await expect(involica.connect(alice).setInvolicaTxFee(0)).to.be.revertedWith('Ownable: caller is not the owner')
    })
    it('should revert if invalid txFee set', async () => {
      await expect(involica.connect(deployer).setInvolicaTxFee(50)).to.be.revertedWith('Invalid txFee')
    })
    it('should set new value', async () => {
      await expect(involica.connect(deployer).setInvolicaTxFee(10)).to.emit(involica, 'SetInvolicaTxFee').withArgs(10)
      expect(await involica.txFee()).to.be.eq(10)
    })
  })

  describe('setResolver()', async () => {
    it('should revert if sender is not owner', async () => {
      await expect(involica.connect(alice).setResolver(alice.address)).to.be.revertedWith(
        'Ownable: caller is not the owner',
      )
    })
    it('should revert if invalid resolver set', async () => {
      await expect(involica.connect(deployer).setResolver(ethers.constants.AddressZero)).to.be.revertedWith(
        'Missing resolver',
      )
    })
    it('should set new value', async () => {
      await expect(involica.connect(deployer).setResolver(deployer.address))
        .to.emit(involica, 'SetResolver')
        .withArgs(deployer.address)
      expect(await involica.resolver()).to.be.eq(deployer.address)
    })
  })
})
