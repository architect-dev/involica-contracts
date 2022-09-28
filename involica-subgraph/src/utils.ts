import { Address, BigDecimal, BigInt } from '@graphprotocol/graph-ts'
import { Involica, Portfolio } from '../generated/schema'

export const createPortfolio = (user: Address): Portfolio => {
  const portfolio = new Portfolio(user.toHex())

  portfolio.dcasCount = 0
  portfolio.manualDcasCount = 0
  portfolio.involicaTxFee = BigInt.fromI32(0)

  portfolio.inTokens = []
  portfolio.inAmounts = []

  portfolio.outTokens = []
  portfolio.outAmounts = []

  return portfolio
}

export const createInvolica = (): Involica => {
  const involica = new Involica('1')

  involica.totalDcasCount = 0
  involica.totalManualDcasCount = 0
  involica.totalInvolicaTxFee = BigInt.fromI32(0)
  involica.totalTradeAmountUsd = BigDecimal.fromString('0')

  involica.inTokens = []
  involica.inAmounts = []

  involica.outTokens = []
  involica.outAmounts = []

  return involica
}

export const ZERO_BI = BigInt.fromI32(0)
export const ONE_BI = BigInt.fromI32(1)

export function exponentToBigDecimal(decimals: BigInt): BigDecimal {
  let bd = BigDecimal.fromString('1')
  for (let i = ZERO_BI; i.lt(decimals as BigInt); i = i.plus(ONE_BI)) {
    bd = bd.times(BigDecimal.fromString('10'))
  }
  return bd
}

export function bigDecimalExp18(): BigDecimal {
  return BigDecimal.fromString('1000000000000000000')
}

export function convertEthToDecimal(eth: BigInt): BigDecimal {
  return eth.toBigDecimal().div(exponentToBigDecimal(BigInt.fromI32(18)))
}

export function convertTokenToDecimal(tokenAmount: BigInt, exchangeDecimals: BigInt): BigDecimal {
  if (exchangeDecimals == ZERO_BI) {
    return tokenAmount.toBigDecimal()
  }
  return tokenAmount.toBigDecimal().div(exponentToBigDecimal(exchangeDecimals))
}
