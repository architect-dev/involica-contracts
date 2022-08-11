/* eslint-disable no-console */
import hre, { ethers } from 'hardhat'
import { BOO_ADDRESS, USDC_ADDRESS, WBTC_ADDRESS, WNATIVE_ADDRESS } from '../constants'
import { readContractAddresses } from '../test/utils'
import { Involica } from '../typechain'

const allowedTokens = [WNATIVE_ADDRESS, USDC_ADDRESS, WBTC_ADDRESS, BOO_ADDRESS]

async function main() {
  const [signer] = await hre.ethers.getSigners()
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const chainId = hre.network.config.chainId!

  // Get Deployed Involica
  const [involicaAddress] = readContractAddresses(chainId, ['involica'])
  const involica = (await ethers.getContractAt('Involica', involicaAddress)) as Involica

  // Build changes to send
  const allTokens: Record<string, boolean> = {}

  const chainAllowedTokens: Record<string, boolean> = {}
  allowedTokens.forEach((token) => {
    if (token[chainId] != null) {
      chainAllowedTokens[token[chainId]] = true
      allTokens[token[chainId]] = true
    }
  })

  // eslint-disable-next-line prettier/prettier
  const existingAllowedTokens: Record<string, boolean> = {}

  ;(await involica.fetchAllowedTokens()).forEach((token: string) => {
    existingAllowedTokens[token] = true
    allTokens[token] = true
  })

  // eslint-disable-next-line prettier/prettier
  const tokenChanges: Record<string, boolean> = {}

  Object.keys(allTokens).forEach((token) => {
    if (chainAllowedTokens[token] === existingAllowedTokens[token]) {
      return
    }
    if (chainAllowedTokens[token] && !existingAllowedTokens[token]) {
      // Should be allowed, but it currency isn't: ADD IT
      tokenChanges[token] = true
      return
    }
    if (!chainAllowedTokens[token] && existingAllowedTokens[token]) {
      // Shouldn't exist, but it currency does: REMOVE IT
      tokenChanges[token] = false
    }
  })

  // eslint-disable-next-line prefer-const
  let tokenAddresses: string[] = []
  // eslint-disable-next-line prefer-const
  let alloweds: boolean[] = []

  Object.entries(tokenChanges).forEach(([tokenAddress, allowed]) => {
    tokenAddresses.push(tokenAddress)
    alloweds.push(allowed)
  })

  // Set data
  involica.connect(signer).setAllowedTokens(tokenAddresses, alloweds)

  console.log('Updated allowed tokens, changes:', tokenChanges)
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
