import { BigDecimal, BigInt } from '@graphprotocol/graph-ts'
import { ExecuteDCA } from '../generated/Involica/Involica'
import { DCA, Involica, Portfolio } from '../generated/schema'
import { convertTokenToDecimal, createInvolica, createPortfolio } from './utils'

export function handleExecuteDCA(event: ExecuteDCA): void {
  // ====    PORTFOLIO    ==== //
  const portfolio = Portfolio.load(event.params.user.toHex()) ?? createPortfolio(event.params.user)

  // Update running counters and amounts
  portfolio.dcasCount = portfolio.dcasCount + 1
  portfolio.involicaTxFee = portfolio.involicaTxFee.plus(event.params.involicaTxFee)
  if (event.params.manualExecution) portfolio.manualDcasCount = portfolio.manualDcasCount + 1

  // Add in token to portfolio
  const inTokenIndex = portfolio.inTokens.findIndex((inToken) => inToken.equals(event.params.tokenIn))
  if (inTokenIndex === -1) {
    portfolio.inTokens.push(event.params.tokenIn)
    portfolio.inAmounts.push(event.params.inAmount)
  } else {
    portfolio.inAmounts[inTokenIndex] = portfolio.inAmounts[inTokenIndex].plus(event.params.inAmount)
  }

  // Add out tokens to portfolio
  for (let i = 0; i < event.params.outTokens.length; i++) {
    const outTokenIndex = portfolio.outTokens.findIndex((outToken) => outToken.equals(event.params.outTokens[i]))
    if (outTokenIndex === -1) {
      portfolio.outTokens.push(event.params.outTokens[i])
      portfolio.outAmounts.push(event.params.outAmounts[i])
    } else {
      portfolio.outAmounts[outTokenIndex] = portfolio.outAmounts[outTokenIndex].plus(event.params.outAmounts[i])
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

  dca.outTokens = event.params.outTokens
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
  const involica = Involica.load('1') ?? createInvolica()

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
  const involicaInTokenIndex = portfolio.inTokens.findIndex((inToken) => inToken.equals(event.params.tokenIn))
  if (involicaInTokenIndex === -1) {
    portfolio.inTokens.push(event.params.tokenIn)
    portfolio.inAmounts.push(event.params.inAmount)
  } else {
    portfolio.inAmounts[involicaInTokenIndex] = portfolio.inAmounts[involicaInTokenIndex].plus(event.params.inAmount)
  }

  // Update out tokens and amounts
  for (let i = 0; i < event.params.outTokens.length; i++) {
    const involicaOutTokenIndex = portfolio.outTokens.findIndex((outToken) =>
      outToken.equals(event.params.outTokens[i]),
    )
    if (involicaOutTokenIndex === -1) {
      portfolio.outTokens.push(event.params.outTokens[i])
      portfolio.outAmounts.push(event.params.outAmounts[i])
    } else {
      portfolio.outAmounts[involicaOutTokenIndex] = portfolio.outAmounts[involicaOutTokenIndex].plus(
        event.params.outAmounts[i],
      )
    }
  }

  // Save involica
  involica.save()
}

// export function handleClearTask(event: ClearTask): void {
//   // Entities can be loaded from the store using a string ID; this ID
//   // needs to be unique across all entities of the same type
//   let entity = ExampleEntity.load(event.transaction.from.toHex())

//   // Entities only exist after they have been saved to the store;
//   // `null` checks allow to create entities on demand
//   if (!entity) {
//     entity = new ExampleEntity(event.transaction.from.toHex())

//     // Entity fields can be set using simple assignments
//     entity.count = BigInt.fromI32(0)
//   }

//   // BigInt and BigDecimal math are supported
//   entity.count = entity.count + BigInt.fromI32(1)

//   // Entity fields can be set based on event parameters
//   entity.user = event.params.user
//   entity.taskId = event.params.taskId

//   // Entities can be written to the store with `.save()`
//   entity.save()

//   // Note: If a handler doesn't require existing field values, it is faster
//   // _not_ to load the entity from the store. Instead, create it fresh with
//   // `new Entity(...)`, set the fields that should be updated and save the
//   // entity back to the store. Fields that were not set or unset remain
//   // unchanged, allowing for partial updates to be applied.

//   // It is also possible to access smart contracts from mappings. For
//   // example, the contract that has emitted the event can be connected to
//   // with:
//   //
//   // let contract = Contract.bind(event.address)
//   //
//   // The following functions can then be called on this contract to access
//   // state variables and other data:
//   //
//   // - contract.ETH(...)
//   // - contract.NATIVE_TOKEN(...)
//   // - contract.blacklistedPairs(...)
//   // - contract.dcaRevertCondition(...)
//   // - contract.fetchAllowedToken(...)
//   // - contract.fetchAllowedTokens(...)
//   // - contract.fetchUniRouter(...)
//   // - contract.fetchUserPosition(...)
//   // - contract.fetchUserTreasury(...)
//   // - contract.fetchUserTxs(...)
//   // - contract.gelato(...)
//   // - contract.involicaTreasury(...)
//   // - contract.minSlippage(...)
//   // - contract.ops(...)
//   // - contract.owner(...)
//   // - contract.paused(...)
//   // - contract.positions(...)
//   // - contract.resolver(...)
//   // - contract.txFee(...)
//   // - contract.uniRouter(...)
//   // - contract.userTreasuries(...)
//   // - contract.userTxs(...)
//   // - contract.weth(...)
// }
