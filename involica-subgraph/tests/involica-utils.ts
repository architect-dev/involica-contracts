import { log, newMockEvent } from 'matchstick-as'
import { ethereum, Address, Bytes, BigInt } from '@graphprotocol/graph-ts'
import { ExecuteDCA } from '../generated/Involica/Involica'

export function createExecuteDCAEvent(
  user: Address,
  recipient: Address,
  tokenIn: Address,
  inAmount: BigInt,
  inPrice: BigInt,
  outTokens: Array<Address>,
  outAmounts: Array<BigInt>,
  outPrices: Array<BigInt>,
  involicaTxFee: BigInt,
  manualExecution: boolean,
): ExecuteDCA {
  const finalizeDcaEvent = changetype<ExecuteDCA>(newMockEvent())

  finalizeDcaEvent.parameters = []

  finalizeDcaEvent.parameters.push(new ethereum.EventParam('user', ethereum.Value.fromAddress(user)))
  finalizeDcaEvent.parameters.push(new ethereum.EventParam('recipient', ethereum.Value.fromAddress(recipient)))
  finalizeDcaEvent.parameters.push(new ethereum.EventParam('tokenIn', ethereum.Value.fromAddress(tokenIn)))
  finalizeDcaEvent.parameters.push(new ethereum.EventParam('inAmount', ethereum.Value.fromUnsignedBigInt(inAmount)))
  finalizeDcaEvent.parameters.push(new ethereum.EventParam('inPrice', ethereum.Value.fromUnsignedBigInt(inPrice)))
  finalizeDcaEvent.parameters.push(new ethereum.EventParam('outTokens', ethereum.Value.fromAddressArray(outTokens)))
  finalizeDcaEvent.parameters.push(
    new ethereum.EventParam('outAmounts', ethereum.Value.fromUnsignedBigIntArray(outAmounts)),
  )
  finalizeDcaEvent.parameters.push(
    new ethereum.EventParam('outPrices', ethereum.Value.fromUnsignedBigIntArray(outPrices)),
  )
  finalizeDcaEvent.parameters.push(
    new ethereum.EventParam('involicaTxFee', ethereum.Value.fromUnsignedBigInt(involicaTxFee)),
  )
  finalizeDcaEvent.parameters.push(
    new ethereum.EventParam('manualExecution', ethereum.Value.fromBoolean(manualExecution)),
  )

  return finalizeDcaEvent
}
