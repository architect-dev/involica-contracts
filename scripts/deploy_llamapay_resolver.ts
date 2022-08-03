import { ethers, run } from 'hardhat'

async function main() {
  const LlamaPayResolverFactory = await ethers.getContractFactory('LlamaPayResolver')
  const llamaPayResolver = await LlamaPayResolverFactory.deploy()
  await llamaPayResolver.deployed()

  console.log('LlamaPay Resolver deployed to:', llamaPayResolver.address)

  await run('verify:verify', {
    address: llamaPayResolver.address,
  })
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
