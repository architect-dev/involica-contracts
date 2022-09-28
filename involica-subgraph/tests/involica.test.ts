import { describe, test, clearStore, afterAll, log } from 'matchstick-as/assembly/index'
import { Address, BigInt } from '@graphprotocol/graph-ts'
import { Involica, Portfolio } from '../generated/schema'
import { handleExecuteDCA } from '../src/involica'
import { createExecuteDCAEvent } from './involica-utils'

// Tests structure (matchstick-as >=0.5.0)
// https://thegraph.com/docs/en/developer/matchstick/#tests-structure-0-5-0

describe('Describe entity assertions', () => {
  afterAll(() => {
    clearStore()
  })

  // For more test scenarios, see:
  // https://thegraph.com/docs/en/developer/matchstick/#write-a-unit-test

  test('DCA created and stored', () => {
    const zeroAddress = Address.fromString('0x0000000000000000000000000000000000000000')
    const user = Address.fromString('0x0000000000000000000000000000000000000001')
    const tokenInAddress = Address.fromString('0x0000000000000000000000000000000000000002')
    const tokenOutAddress1 = Address.fromString('0x0000000000000000000000000000000000000003')
    const tokenOutAddress2 = Address.fromString('0x0000000000000000000000000000000000000005')
    const newExecuteDCAEvent = createExecuteDCAEvent(
      user,
      zeroAddress,
      tokenInAddress,
      BigInt.fromI32(100),
      BigInt.fromI32(100),
      [tokenOutAddress1, tokenOutAddress2, tokenOutAddress1],
      [BigInt.fromI32(50), BigInt.fromI32(250), BigInt.fromI32(0)],
      [BigInt.fromI32(210000), BigInt.fromI32(35600), BigInt.fromI32(10)],
      BigInt.fromI32(5000),
      false,
    )

    log.info(
      'config out tokens',
      newExecuteDCAEvent.params.outTokens.map<string>((addr: Address) => addr.toHexString()),
    )
    handleExecuteDCA(newExecuteDCAEvent)

    const involica = Involica.load('1')
    if (involica != null) {
      log.info('involica id = {}, dcasCount = {}', [involica.id, involica.totalDcasCount.toString()])
      log.info('involica in token 0 = {}', [involica.inTokens[0].toHexString()])
      log.info('involica out tokens = {}', [involica.outTokens.map<string>((addr) => addr.toHexString()).join(', ')])
    }

    const portfolio = Portfolio.load(user.toHexString())
    if (portfolio != null) {
      log.info('portfolio id = {}, dcasCount = {}', [portfolio.id, portfolio.dcasCount.toString()])
      log.info('portfolio in token 0 = {}', [portfolio.inTokens[0].toHexString()])
      log.info('portfolio out tokens = {}', [portfolio.outTokens.map<string>((addr) => addr.toHexString()).join(', ')])
    }
    // assert.entityCount('DCA', 1)

    // // 0xa16081f360e3847006db660bae1c6d1b2e17ec2a is the default address used in newMockEvent() function
    // assert.fieldEquals('ExampleEntity', '0xa16081f360e3847006db660bae1c6d1b2e17ec2a', 'dcasCount', '1')
    // assert.fieldEquals('ExampleEntity', '0xa16081f360e3847006db660bae1c6d1b2e17ec2a', 'taskId', '1234567890')

    // More assert options:
    // https://thegraph.com/docs/en/developer/matchstick/#asserts
  })
})
