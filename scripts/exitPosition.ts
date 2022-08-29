/* eslint-disable no-console */
import hre, { ethers } from 'hardhat'
import { IERC20, Involica } from '../typechain'
import ERC20ABI from '../data/abi/ERC20.json'

export const exitPosition = async (): Promise<void> => {
  const [signer] = await hre.ethers.getSigners()

  const involicaAddress = '0x5104B1520b9d789512B85D7Bb0b4680E79A184C0'
  const involica = (await ethers.getContractAt('Involica', involicaAddress)) as Involica

  const tokenIn = (await involica.fetchUserPosition(signer.address)).tokenIn
  const tokenInContract = (await ethers.getContractAt(ERC20ABI, tokenIn)) as IERC20

  const allowanceTx = await tokenInContract.connect(signer).approve(involica.address, 0)
  await allowanceTx.wait()

  console.log('Withdrew Approval')

  const tx = await involica.connect(signer).exitPosition()
  await tx.wait()

  console.log('Exited Position')
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
exitPosition()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
