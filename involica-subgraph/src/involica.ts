import { Address, BigDecimal, BigInt, Bytes } from '@graphprotocol/graph-ts'
import { ExecuteDCA, SetPosition } from '../generated/Involica/Involica'
import { DCA, Involica, InvolicaSnapshot, Portfolio, PositionConfig } from '../generated/schema'
import {
  convertEthToDecimal,
  convertTokenToDecimal,
  createInvolica,
  createInvolicaSnapshot,
  createPortfolio,
  tokenAndAmountToDecimal,
} from './utils'

export function handleExecuteDCA(event: ExecuteDCA): void {
  let involica = Involica.load('1')
  if (involica == null) involica = createInvolica()

  // Reusables
  const involicaTxFeeUsd = convertEthToDecimal(event.params.involicaTxFee).times(
    convertTokenToDecimal(event.params.inPrice, BigInt.fromI32(6)),
  )

  // ====    PORTFOLIO    ==== //
  let isNewUser = false
  let portfolio = Portfolio.load(event.params.user.toHexString())
  if (portfolio == null) {
    portfolio = createPortfolio(event.params.user)
    isNewUser = true
  }

  // Update running counters and amounts
  portfolio.dcasCount = portfolio.dcasCount + 1
  portfolio.involicaTxFeeUsd = portfolio.involicaTxFeeUsd.plus(involicaTxFeeUsd)
  if (event.params.manualExecution) portfolio.manualDcasCount = portfolio.manualDcasCount + 1

  // Add in token to portfolio
  const inTokenIndex = portfolio.inTokens.indexOf(event.params.tokenIn)
  if (inTokenIndex === -1) {
    portfolio.inTokens = portfolio.inTokens.concat([event.params.tokenIn])
    portfolio.inAmounts = portfolio.inAmounts.concat([
      tokenAndAmountToDecimal(event.params.tokenIn, event.params.inAmount),
    ])
  } else {
    const updatedAmounts = portfolio.inAmounts
    updatedAmounts[inTokenIndex] = portfolio.inAmounts[inTokenIndex].plus(
      tokenAndAmountToDecimal(event.params.tokenIn, event.params.inAmount),
    )
    portfolio.inAmounts = updatedAmounts
  }

  // Add out tokens to portfolio
  for (let i = 0; i < event.params.outTokens.length; i++) {
    const outTokenIndex = portfolio.outTokens.indexOf(event.params.outTokens[i])
    if (outTokenIndex === -1) {
      portfolio.outTokens = portfolio.outTokens.concat([event.params.outTokens[i]])
      portfolio.outAmounts = portfolio.outAmounts.concat([
        tokenAndAmountToDecimal(event.params.outTokens[i], event.params.outAmounts[i]),
      ])
    } else {
      const updatedAmounts = portfolio.outAmounts
      updatedAmounts[outTokenIndex] = portfolio.outAmounts[outTokenIndex].plus(
        tokenAndAmountToDecimal(event.params.outTokens[i], event.params.outAmounts[i]),
      )
      portfolio.outAmounts = updatedAmounts
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
  dca.inAmount = tokenAndAmountToDecimal(event.params.tokenIn, event.params.inAmount)
  dca.inPrice = convertTokenToDecimal(event.params.inPrice, BigInt.fromI32(6))

  const outTokens: Address[] = event.params.outTokens
  dca.outTokens = outTokens.map<Bytes>((addr: Address) => addr as Bytes)
  const outAmounts: BigDecimal[] = []
  const outPrices: BigDecimal[] = []
  for (let i = 0; i < event.params.outTokens.length; i++) {
    outAmounts.push(tokenAndAmountToDecimal(event.params.outTokens[i], event.params.outAmounts[i]))
    outPrices.push(convertTokenToDecimal(event.params.outPrices[i], BigInt.fromI32(6)))
  }
  dca.outAmounts = outAmounts
  dca.outPrices = outPrices

  dca.involicaTxFeeUsd = involicaTxFeeUsd

  // Insert snapshot of portfolio after DCA
  dca.portfolioInTokens = portfolio.inTokens
  dca.portfolioInAmounts = portfolio.inAmounts

  dca.portfolioOutTokens = portfolio.outTokens
  dca.portfolioOutAmounts = portfolio.outAmounts

  // Update running portfolio counters
  dca.dcasCount = portfolio.dcasCount
  dca.manualDcasCount = portfolio.manualDcasCount
  dca.totalInvolicaTxFeeUsd = portfolio.involicaTxFeeUsd

  // Save DCA
  dca.save()

  // ====    INVOLICA GLOBAL STATS    ==== //

  // Update running counters and amounts
  if (isNewUser) involica.totalUserCount = involica.totalUserCount + 1
  involica.totalDcasCount = involica.totalDcasCount + 1
  if (event.params.manualExecution) involica.totalManualDcasCount = involica.totalManualDcasCount + 1
  involica.totalInvolicaTxFeeUsd = involica.totalInvolicaTxFeeUsd.plus(involicaTxFeeUsd)

  // Update total trade amount usd
  let tradeUsd: BigDecimal = BigDecimal.fromString('0')
  for (let i = 0; i < event.params.outTokens.length; i++) {
    tradeUsd = tradeUsd.plus(dca.outAmounts[i].times(dca.outPrices[i]))
  }
  involica.totalTradeAmountUsd = involica.totalTradeAmountUsd.plus(tradeUsd)

  // Update in tokens and amounts
  const involicaInTokenIndex = involica.inTokens.indexOf(event.params.tokenIn)
  if (involicaInTokenIndex === -1) {
    involica.inTokens = involica.inTokens.concat([event.params.tokenIn])
    involica.inAmounts = involica.inAmounts.concat([
      tokenAndAmountToDecimal(event.params.tokenIn, event.params.inAmount),
    ])
  } else {
    const updatedAmounts = involica.inAmounts
    updatedAmounts[involicaInTokenIndex] = involica.inAmounts[involicaInTokenIndex].plus(
      tokenAndAmountToDecimal(event.params.tokenIn, event.params.inAmount),
    )
    involica.inAmounts = updatedAmounts
  }

  // Update out tokens and amounts
  for (let i = 0; i < event.params.outTokens.length; i++) {
    const involicaOutTokenIndex = involica.outTokens.indexOf(event.params.outTokens[i])
    if (involicaOutTokenIndex === -1) {
      involica.outTokens = involica.outTokens.concat([event.params.outTokens[i]])
      involica.outAmounts = involica.outAmounts.concat([
        tokenAndAmountToDecimal(event.params.outTokens[i], event.params.outAmounts[i]),
      ])
    } else {
      const updatedAmounts = involica.outAmounts
      updatedAmounts[involicaOutTokenIndex] = involica.outAmounts[involicaOutTokenIndex].plus(
        tokenAndAmountToDecimal(event.params.outTokens[i], event.params.outAmounts[i]),
      )
      involica.outAmounts = updatedAmounts
    }
  }

  // Save involica
  involica.save()

  // ====    INVOLICA SNAPSHOT    ==== //
  const dayTimestamp = Math.floor(event.block.timestamp.toI32() / 86400) * 86400
  let snapshot = InvolicaSnapshot.load(dayTimestamp.toString())
  if (snapshot == null) snapshot = createInvolicaSnapshot(dayTimestamp)

  // Increment snapshot dcas
  snapshot.dcasCount = snapshot.dcasCount + 1
  if (isNewUser) snapshot.userCount = snapshot.userCount + 1

  // Update in tokens and amounts
  const snapshotInTokenIndex = snapshot.inTokens.indexOf(event.params.tokenIn)
  if (snapshotInTokenIndex === -1) {
    snapshot.inTokens = snapshot.inTokens.concat([event.params.tokenIn])
    snapshot.inAmounts = snapshot.inAmounts.concat([
      tokenAndAmountToDecimal(event.params.tokenIn, event.params.inAmount),
    ])
    snapshot.inPrices = snapshot.inPrices.concat([convertTokenToDecimal(event.params.inPrice, BigInt.fromI32(6))])
  } else {
    const updatedAmounts = snapshot.inAmounts
    updatedAmounts[snapshotInTokenIndex] = snapshot.inAmounts[snapshotInTokenIndex].plus(
      tokenAndAmountToDecimal(event.params.tokenIn, event.params.inAmount),
    )
    snapshot.inAmounts = updatedAmounts

    const updatedPrices = snapshot.inPrices
    updatedPrices[snapshotInTokenIndex] = convertTokenToDecimal(event.params.inPrice, BigInt.fromI32(6))
    snapshot.inPrices = updatedPrices
  }

  // Update out tokens and amounts
  for (let i = 0; i < event.params.outTokens.length; i++) {
    const involicaOutTokenIndex = snapshot.outTokens.indexOf(event.params.outTokens[i])
    if (involicaOutTokenIndex === -1) {
      snapshot.outTokens = snapshot.outTokens.concat([event.params.outTokens[i]])
      snapshot.outAmounts = snapshot.outAmounts.concat([
        tokenAndAmountToDecimal(event.params.outTokens[i], event.params.outAmounts[i]),
      ])
    } else {
      const updatedAmounts = snapshot.outAmounts
      updatedAmounts[involicaOutTokenIndex] = snapshot.outAmounts[involicaOutTokenIndex].plus(
        tokenAndAmountToDecimal(event.params.outTokens[i], event.params.outAmounts[i]),
      )
      snapshot.outAmounts = updatedAmounts

      const updatedPrices = snapshot.outPrices
      updatedPrices[involicaOutTokenIndex] = convertTokenToDecimal(event.params.outPrices[i], BigInt.fromI32(6))
      snapshot.outPrices = updatedPrices
    }
  }

  // Save Snapshot
  snapshot.save()
}

export function handleSetPosition(event: SetPosition): void {
  const id = [
    event.params.owner.toHexString(),
    'in',
    `token:${event.params.tokenIn.toHexString()}_amount${event.params.amountDCA.toString()}`,
    'outs',
    event.params.outs
      .map<string>(
        (out): string =>
          `(token:${out.token.toHexString()}_weight:${out.weight.toString()}_slippage:${out.maxSlippage.toString()})`,
      )
      .join(','),
  ].join('_')

  let positionConfig = PositionConfig.load(id)
  if (positionConfig == null) {
    // Populate and save position config if it is new. If it exists then no need
    positionConfig = new PositionConfig(id)

    positionConfig.inToken = event.params.tokenIn
    positionConfig.inAmount = tokenAndAmountToDecimal(event.params.tokenIn, event.params.amountDCA)

    const outTokens: Bytes[] = []
    const outWeights: i32[] = []
    const outSlippages: i32[] = []

    for (let i = 0; i < event.params.outs.length; i++) {
      outTokens.push(event.params.outs[i].token)
      outWeights.push(event.params.outs[i].weight.toI32())
      outSlippages.push(event.params.outs[i].maxSlippage.toI32())
    }

    positionConfig.outTokens = outTokens
    positionConfig.outWeights = outWeights
    positionConfig.outSlippages = outSlippages

    positionConfig.save()
  }
}
