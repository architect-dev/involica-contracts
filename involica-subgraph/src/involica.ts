import { Address, BigDecimal, BigInt, Bytes } from '@graphprotocol/graph-ts'
import { ExecuteDCA } from '../generated/Involica/Involica'
import { DCA, Involica, Portfolio } from '../generated/schema'
import { convertTokenToDecimal, createInvolica, createPortfolio } from './utils'

let gBigInt: BigInt

export function handleExecuteDCA(event: ExecuteDCA): void {
  // ====    PORTFOLIO    ==== //
  let portfolio = Portfolio.load(event.params.user.toHexString())
  if (portfolio == null) portfolio = createPortfolio(event.params.user)

  // Update running counters and amounts
  portfolio.dcasCount = portfolio.dcasCount + 1
  portfolio.involicaTxFee = portfolio.involicaTxFee.plus(event.params.involicaTxFee)
  if (event.params.manualExecution) portfolio.manualDcasCount = portfolio.manualDcasCount + 1

  // Add in token to portfolio
  const inTokenIndex = portfolio.inTokens.indexOf(event.params.tokenIn)
  if (inTokenIndex === -1) {
    portfolio.inTokens = portfolio.inTokens.concat([event.params.tokenIn])
    portfolio.inAmounts = portfolio.inAmounts.concat([event.params.inAmount])
  } else {
    portfolio.inAmounts[inTokenIndex] = portfolio.inAmounts[inTokenIndex].plus(event.params.inAmount)
  }

  // Add out tokens to portfolio
  for (let i = 0; i < event.params.outTokens.length; i++) {
    const outTokenIndex = portfolio.outTokens.indexOf(event.params.outTokens[i])
    if (outTokenIndex === -1) {
      portfolio.outTokens = portfolio.outTokens.concat([event.params.outTokens[i]])
      portfolio.outAmounts = portfolio.outAmounts.concat([event.params.outAmounts[i]])
    } else {
      gBigInt = event.params.outAmounts[i]
      portfolio.outAmounts[outTokenIndex] = portfolio.outAmounts[outTokenIndex].plus(gBigInt)
    }
  }

  // Save Portfolio
  portfolio.save()

  // ====    DCA    ==== //
  const dca = new DCA(event.transaction.hash.toHex())
  dca.user = event.params.user

  // DCA details
  dca.recipient = event.params.recipient
  dca.manualExecution = event.params.manualExecution
  dca.timestamp = event.block.timestamp

  dca.inToken = event.params.tokenIn
  dca.inAmount = event.params.inAmount

  const outTokens: Address[] = event.params.outTokens
  dca.outTokens = outTokens.map<Bytes>((addr: Address) => addr as Bytes)
  dca.outAmounts = event.params.outAmounts

  dca.involicaTxFee = event.params.involicaTxFee

  // Insert snapshot of portfolio after DCA
  dca.portfolioInTokens = portfolio.inTokens
  dca.portfolioInAmounts = portfolio.inAmounts

  dca.portfolioOutTokens = portfolio.outTokens
  dca.portfolioOutAmounts = portfolio.outAmounts

  // Update running portfolio counters
  dca.dcasCount = portfolio.dcasCount
  dca.manualDcasCount = portfolio.manualDcasCount
  dca.totalInvolicaTxFee = portfolio.involicaTxFee

  // Save DCA
  dca.save()

  // ====    INVOLICA GLOBAL STATS    ==== //
  let involica = Involica.load('1')
  if (involica == null) involica = createInvolica()

  // Update running counters and amounts
  involica.totalDcasCount = involica.totalDcasCount + 1
  if (event.params.manualExecution) involica.totalManualDcasCount = involica.totalManualDcasCount + 1
  involica.totalInvolicaTxFee = involica.totalInvolicaTxFee.plus(event.params.involicaTxFee)

  // Update total trade amount usd
  const tradeUsd = BigDecimal.fromString(event.params.inAmount.toString()).div(
    convertTokenToDecimal(event.params.inPrice, BigInt.fromI32(6)),
  )
  involica.totalTradeAmountUsd = involica.totalTradeAmountUsd.plus(tradeUsd)

  // Update in tokens and amounts
  const involicaInTokenIndex = involica.inTokens.indexOf(event.params.tokenIn)
  if (involicaInTokenIndex === -1) {
    involica.inTokens = involica.inTokens.concat([event.params.tokenIn])
    involica.inAmounts = involica.inAmounts.concat([event.params.inAmount])
  } else {
    involica.inAmounts[involicaInTokenIndex] = involica.inAmounts[involicaInTokenIndex].plus(event.params.inAmount)
  }

  // Update out tokens and amounts
  for (let i = 0; i < event.params.outTokens.length; i++) {
    const involicaOutTokenIndex = involica.outTokens.indexOf(event.params.outTokens[i])
    if (involicaOutTokenIndex === -1) {
      involica.outTokens = involica.outTokens.concat([event.params.outTokens[i]])
      involica.outAmounts = involica.outAmounts.concat([event.params.outAmounts[i]])
    } else {
      gBigInt = event.params.outAmounts[i]
      involica.outAmounts[involicaOutTokenIndex] = involica.outAmounts[involicaOutTokenIndex].plus(gBigInt)
    }
  }

  // Save involica
  involica.save()
}
