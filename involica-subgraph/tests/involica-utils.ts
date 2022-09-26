import { newMockEvent } from "matchstick-as"
import { ethereum, Address, Bytes, BigInt } from "@graphprotocol/graph-ts"
import {
  ClearTask,
  DepositTreasury,
  ExitPosition,
  FinalizeDCA,
  InitializeTask,
  MinSlippageSet,
  OwnershipTransferred,
  PausePosition,
  Paused,
  PositionUpdated,
  SetAllowedToken,
  SetBlacklistedPair,
  SetInvolicaTreasury,
  SetInvolicaTxFee,
  SetPaused,
  SetPosition,
  SetResolver,
  Unpaused,
  WithdrawTreasury
} from "../generated/Involica/Involica"

export function createClearTaskEvent(user: Address, taskId: Bytes): ClearTask {
  let clearTaskEvent = changetype<ClearTask>(newMockEvent())

  clearTaskEvent.parameters = new Array()

  clearTaskEvent.parameters.push(
    new ethereum.EventParam("user", ethereum.Value.fromAddress(user))
  )
  clearTaskEvent.parameters.push(
    new ethereum.EventParam("taskId", ethereum.Value.fromFixedBytes(taskId))
  )

  return clearTaskEvent
}

export function createDepositTreasuryEvent(
  user: Address,
  amount: BigInt
): DepositTreasury {
  let depositTreasuryEvent = changetype<DepositTreasury>(newMockEvent())

  depositTreasuryEvent.parameters = new Array()

  depositTreasuryEvent.parameters.push(
    new ethereum.EventParam("user", ethereum.Value.fromAddress(user))
  )
  depositTreasuryEvent.parameters.push(
    new ethereum.EventParam("amount", ethereum.Value.fromUnsignedBigInt(amount))
  )

  return depositTreasuryEvent
}

export function createExitPositionEvent(user: Address): ExitPosition {
  let exitPositionEvent = changetype<ExitPosition>(newMockEvent())

  exitPositionEvent.parameters = new Array()

  exitPositionEvent.parameters.push(
    new ethereum.EventParam("user", ethereum.Value.fromAddress(user))
  )

  return exitPositionEvent
}

export function createFinalizeDCAEvent(
  user: Address,
  recipient: Address,
  tokenIn: Address,
  inAmount: BigInt,
  inPrice: BigInt,
  outTokens: Array<Address>,
  outAmounts: Array<BigInt>,
  outPrices: Array<BigInt>,
  involicaTxFee: BigInt
): FinalizeDCA {
  let finalizeDcaEvent = changetype<FinalizeDCA>(newMockEvent())

  finalizeDcaEvent.parameters = new Array()

  finalizeDcaEvent.parameters.push(
    new ethereum.EventParam("user", ethereum.Value.fromAddress(user))
  )
  finalizeDcaEvent.parameters.push(
    new ethereum.EventParam("recipient", ethereum.Value.fromAddress(recipient))
  )
  finalizeDcaEvent.parameters.push(
    new ethereum.EventParam("tokenIn", ethereum.Value.fromAddress(tokenIn))
  )
  finalizeDcaEvent.parameters.push(
    new ethereum.EventParam(
      "inAmount",
      ethereum.Value.fromUnsignedBigInt(inAmount)
    )
  )
  finalizeDcaEvent.parameters.push(
    new ethereum.EventParam(
      "inPrice",
      ethereum.Value.fromUnsignedBigInt(inPrice)
    )
  )
  finalizeDcaEvent.parameters.push(
    new ethereum.EventParam(
      "outTokens",
      ethereum.Value.fromAddressArray(outTokens)
    )
  )
  finalizeDcaEvent.parameters.push(
    new ethereum.EventParam(
      "outAmounts",
      ethereum.Value.fromUnsignedBigIntArray(outAmounts)
    )
  )
  finalizeDcaEvent.parameters.push(
    new ethereum.EventParam(
      "outPrices",
      ethereum.Value.fromUnsignedBigIntArray(outPrices)
    )
  )
  finalizeDcaEvent.parameters.push(
    new ethereum.EventParam(
      "involicaTxFee",
      ethereum.Value.fromUnsignedBigInt(involicaTxFee)
    )
  )

  return finalizeDcaEvent
}

export function createInitializeTaskEvent(
  user: Address,
  taskId: Bytes
): InitializeTask {
  let initializeTaskEvent = changetype<InitializeTask>(newMockEvent())

  initializeTaskEvent.parameters = new Array()

  initializeTaskEvent.parameters.push(
    new ethereum.EventParam("user", ethereum.Value.fromAddress(user))
  )
  initializeTaskEvent.parameters.push(
    new ethereum.EventParam("taskId", ethereum.Value.fromFixedBytes(taskId))
  )

  return initializeTaskEvent
}

export function createMinSlippageSetEvent(minSlippage: BigInt): MinSlippageSet {
  let minSlippageSetEvent = changetype<MinSlippageSet>(newMockEvent())

  minSlippageSetEvent.parameters = new Array()

  minSlippageSetEvent.parameters.push(
    new ethereum.EventParam(
      "minSlippage",
      ethereum.Value.fromUnsignedBigInt(minSlippage)
    )
  )

  return minSlippageSetEvent
}

export function createOwnershipTransferredEvent(
  previousOwner: Address,
  newOwner: Address
): OwnershipTransferred {
  let ownershipTransferredEvent = changetype<OwnershipTransferred>(
    newMockEvent()
  )

  ownershipTransferredEvent.parameters = new Array()

  ownershipTransferredEvent.parameters.push(
    new ethereum.EventParam(
      "previousOwner",
      ethereum.Value.fromAddress(previousOwner)
    )
  )
  ownershipTransferredEvent.parameters.push(
    new ethereum.EventParam("newOwner", ethereum.Value.fromAddress(newOwner))
  )

  return ownershipTransferredEvent
}

export function createPausePositionEvent(
  user: Address,
  paused: boolean
): PausePosition {
  let pausePositionEvent = changetype<PausePosition>(newMockEvent())

  pausePositionEvent.parameters = new Array()

  pausePositionEvent.parameters.push(
    new ethereum.EventParam("user", ethereum.Value.fromAddress(user))
  )
  pausePositionEvent.parameters.push(
    new ethereum.EventParam("paused", ethereum.Value.fromBoolean(paused))
  )

  return pausePositionEvent
}

export function createPausedEvent(account: Address): Paused {
  let pausedEvent = changetype<Paused>(newMockEvent())

  pausedEvent.parameters = new Array()

  pausedEvent.parameters.push(
    new ethereum.EventParam("account", ethereum.Value.fromAddress(account))
  )

  return pausedEvent
}

export function createPositionUpdatedEvent(
  user: Address,
  amountDCA: BigInt,
  intervalDCA: BigInt,
  maxSlippage: BigInt,
  maxGasPrice: BigInt
): PositionUpdated {
  let positionUpdatedEvent = changetype<PositionUpdated>(newMockEvent())

  positionUpdatedEvent.parameters = new Array()

  positionUpdatedEvent.parameters.push(
    new ethereum.EventParam("user", ethereum.Value.fromAddress(user))
  )
  positionUpdatedEvent.parameters.push(
    new ethereum.EventParam(
      "amountDCA",
      ethereum.Value.fromUnsignedBigInt(amountDCA)
    )
  )
  positionUpdatedEvent.parameters.push(
    new ethereum.EventParam(
      "intervalDCA",
      ethereum.Value.fromUnsignedBigInt(intervalDCA)
    )
  )
  positionUpdatedEvent.parameters.push(
    new ethereum.EventParam(
      "maxSlippage",
      ethereum.Value.fromUnsignedBigInt(maxSlippage)
    )
  )
  positionUpdatedEvent.parameters.push(
    new ethereum.EventParam(
      "maxGasPrice",
      ethereum.Value.fromUnsignedBigInt(maxGasPrice)
    )
  )

  return positionUpdatedEvent
}

export function createSetAllowedTokenEvent(
  token: Address,
  allowed: boolean
): SetAllowedToken {
  let setAllowedTokenEvent = changetype<SetAllowedToken>(newMockEvent())

  setAllowedTokenEvent.parameters = new Array()

  setAllowedTokenEvent.parameters.push(
    new ethereum.EventParam("token", ethereum.Value.fromAddress(token))
  )
  setAllowedTokenEvent.parameters.push(
    new ethereum.EventParam("allowed", ethereum.Value.fromBoolean(allowed))
  )

  return setAllowedTokenEvent
}

export function createSetBlacklistedPairEvent(
  tokenA: Address,
  tokenB: Address,
  blacklisted: boolean
): SetBlacklistedPair {
  let setBlacklistedPairEvent = changetype<SetBlacklistedPair>(newMockEvent())

  setBlacklistedPairEvent.parameters = new Array()

  setBlacklistedPairEvent.parameters.push(
    new ethereum.EventParam("tokenA", ethereum.Value.fromAddress(tokenA))
  )
  setBlacklistedPairEvent.parameters.push(
    new ethereum.EventParam("tokenB", ethereum.Value.fromAddress(tokenB))
  )
  setBlacklistedPairEvent.parameters.push(
    new ethereum.EventParam(
      "blacklisted",
      ethereum.Value.fromBoolean(blacklisted)
    )
  )

  return setBlacklistedPairEvent
}

export function createSetInvolicaTreasuryEvent(
  treasury: Address
): SetInvolicaTreasury {
  let setInvolicaTreasuryEvent = changetype<SetInvolicaTreasury>(newMockEvent())

  setInvolicaTreasuryEvent.parameters = new Array()

  setInvolicaTreasuryEvent.parameters.push(
    new ethereum.EventParam("treasury", ethereum.Value.fromAddress(treasury))
  )

  return setInvolicaTreasuryEvent
}

export function createSetInvolicaTxFeeEvent(txFee: BigInt): SetInvolicaTxFee {
  let setInvolicaTxFeeEvent = changetype<SetInvolicaTxFee>(newMockEvent())

  setInvolicaTxFeeEvent.parameters = new Array()

  setInvolicaTxFeeEvent.parameters.push(
    new ethereum.EventParam("txFee", ethereum.Value.fromUnsignedBigInt(txFee))
  )

  return setInvolicaTxFeeEvent
}

export function createSetPausedEvent(paused: boolean): SetPaused {
  let setPausedEvent = changetype<SetPaused>(newMockEvent())

  setPausedEvent.parameters = new Array()

  setPausedEvent.parameters.push(
    new ethereum.EventParam("paused", ethereum.Value.fromBoolean(paused))
  )

  return setPausedEvent
}

export function createSetPositionEvent(
  owner: Address,
  recipient: Address,
  tokenIn: Address,
  outs: Array<ethereum.Tuple>,
  amountDCA: BigInt,
  intervalDCA: BigInt,
  maxGasPrice: BigInt,
  manualExecutionOnly: boolean
): SetPosition {
  let setPositionEvent = changetype<SetPosition>(newMockEvent())

  setPositionEvent.parameters = new Array()

  setPositionEvent.parameters.push(
    new ethereum.EventParam("owner", ethereum.Value.fromAddress(owner))
  )
  setPositionEvent.parameters.push(
    new ethereum.EventParam("recipient", ethereum.Value.fromAddress(recipient))
  )
  setPositionEvent.parameters.push(
    new ethereum.EventParam("tokenIn", ethereum.Value.fromAddress(tokenIn))
  )
  setPositionEvent.parameters.push(
    new ethereum.EventParam("outs", ethereum.Value.fromTupleArray(outs))
  )
  setPositionEvent.parameters.push(
    new ethereum.EventParam(
      "amountDCA",
      ethereum.Value.fromUnsignedBigInt(amountDCA)
    )
  )
  setPositionEvent.parameters.push(
    new ethereum.EventParam(
      "intervalDCA",
      ethereum.Value.fromUnsignedBigInt(intervalDCA)
    )
  )
  setPositionEvent.parameters.push(
    new ethereum.EventParam(
      "maxGasPrice",
      ethereum.Value.fromUnsignedBigInt(maxGasPrice)
    )
  )
  setPositionEvent.parameters.push(
    new ethereum.EventParam(
      "manualExecutionOnly",
      ethereum.Value.fromBoolean(manualExecutionOnly)
    )
  )

  return setPositionEvent
}

export function createSetResolverEvent(resolver: Address): SetResolver {
  let setResolverEvent = changetype<SetResolver>(newMockEvent())

  setResolverEvent.parameters = new Array()

  setResolverEvent.parameters.push(
    new ethereum.EventParam("resolver", ethereum.Value.fromAddress(resolver))
  )

  return setResolverEvent
}

export function createUnpausedEvent(account: Address): Unpaused {
  let unpausedEvent = changetype<Unpaused>(newMockEvent())

  unpausedEvent.parameters = new Array()

  unpausedEvent.parameters.push(
    new ethereum.EventParam("account", ethereum.Value.fromAddress(account))
  )

  return unpausedEvent
}

export function createWithdrawTreasuryEvent(
  user: Address,
  amount: BigInt
): WithdrawTreasury {
  let withdrawTreasuryEvent = changetype<WithdrawTreasury>(newMockEvent())

  withdrawTreasuryEvent.parameters = new Array()

  withdrawTreasuryEvent.parameters.push(
    new ethereum.EventParam("user", ethereum.Value.fromAddress(user))
  )
  withdrawTreasuryEvent.parameters.push(
    new ethereum.EventParam("amount", ethereum.Value.fromUnsignedBigInt(amount))
  )

  return withdrawTreasuryEvent
}
