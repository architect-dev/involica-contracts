import { BigNumber, BigNumberish } from 'ethers/lib/ethers'
import { ethers, network } from 'hardhat'
import { USDC_ADDRESS, USDC_OWNING_WALLET } from '../constants'
import { Involica } from '../typechain'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { parseEther } from 'ethers/lib/utils'

export const setAllowedTokens = async (involica: Involica, tokens: string[], alloweds: boolean[]) => {
	await involica.setAllowedTokens(tokens, alloweds)
}
export const setAllowedToken = async (involica: Involica, token: string, allowed: boolean) => {
	await setAllowedTokens(involica, [token], [allowed])
}

export const setBlacklistedPairs = async (involica: Involica, pairs: string[][], blacklisteds: boolean[]) => {
	await involica.setBlacklistedPairs(pairs.flat(), blacklisteds)
}
export const setBlacklistedPair = async (involica: Involica, pair: string[], blacklisted: boolean) => {
	await setBlacklistedPairs(involica, [pair], [blacklisted])
}

export const mintUsdc = async (chainId: number, amount: BigNumberish, to: string) => {
	const usdc = await ethers.getContractAt('IERC20', USDC_ADDRESS[chainId])

	await network.provider.request({
		method: 'hardhat_impersonateAccount',
		params: [USDC_OWNING_WALLET[chainId]],
	})

	const usdcWalletSigner = await ethers.getSigner(USDC_OWNING_WALLET[chainId])
	await usdc.connect(usdcWalletSigner).transfer(to, amount)
}

export const getCurrentTimestamp = async (): Promise<BigNumber> => {
	const block = await ethers.provider.getBlock('latest')
	return BigNumber.from(block.timestamp)
}

export const fastForwardTo = async (timestamp: number) => {
	await ethers.provider.send('evm_setNextBlockTimestamp', [timestamp])
	await ethers.provider.send('evm_mine', [])
}

export const impersonateAccount = async (address: string): Promise<SignerWithAddress> => {
	await network.provider.request({
		method: 'hardhat_impersonateAccount',
		params: [address],
	})

	return ethers.getSigner(address)
}

export const ONE_ETH = parseEther('1')

export const parseGwei = (value: BigNumberish) => BigNumber.from(value).mul(1000000000)
