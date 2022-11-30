/* eslint-disable no-console */
import hre, { ethers } from 'hardhat'
import { readContractAddresses } from '../test/utils'
import { Involica, InvolicaFetcher, InvolicaResolver, Oracle } from '../typechain'
import uniabi from './uniabi.json'

export const checkOnTask = async (): Promise<void> => {
  const [_, expedition] = await hre.ethers.getSigners()
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const chainId = 250

  // Get Deployed Involica
  const [involicaAdd, fetcherAdd, oracleAdd] = readContractAddresses(chainId, ['involica', 'fetcher', 'oracle'])
  const involica = (await ethers.getContractAt('Involica', involicaAdd)) as Involica
  const uniRouterAdd = await involica.fetchUniRouter()
  console.log({
    uniRouterAdd,
  })
  const uniRouter = await ethers.getContractAt(uniabi, uniRouterAdd)
  console.log({
    uniRouter,
  })
  const fetcher = (await ethers.getContractAt('InvolicaFetcher', fetcherAdd)) as InvolicaFetcher
  const oracle = (await ethers.getContractAt('Oracle', oracleAdd)) as Oracle

  const position = await involica.fetchUserPosition(expedition.address)
  console.log({
    position,
  })

  // const userData = await fetcher.fetchUserData(signer.address)
  // console.log({
  //   userData,
  // })

  const { outs, tokenIn, amountDCA } = position
  console.log({
    tokenIn,
    outs,
  })
  for (let i = 0; i < outs.length; i++) {
    const route = await oracle.getRoute(tokenIn, outs[i].token)
    const amounts = await uniRouter.getAmountsOut(
      amountDCA
        .mul(outs[i].weight)
        .mul(10000 - 10)
        .div(10000 * 10000),
      route,
    )
    console.log({
      route,
      amounts,
      maxSlippage: outs[i].maxSlippage,
    })
  }

  // const execConditions = await resolver.fetchPositionExecConditions(signer.address)

  // console.log(execConditions)
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
checkOnTask()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
