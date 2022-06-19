import hre from "hardhat";
import {
  OPS_ADDRESS,
  ROUTER_ADDRESS,
  WETH_ADDRESS
} from "../constants";
import { InvolicaResolver__factory, Involica__factory } from "../typechain";

async function main() {
  const [signer] = await hre.ethers.getSigners();
  const chainId = hre.network.config.chainId!;

  // DEPLOY PORTFOLIO DCA
  const InvolicaFactory = <Involica__factory>(
    await hre.ethers.getContractFactory("Involica", signer)
  );

  const involica = await InvolicaFactory.deploy(
    OPS_ADDRESS[chainId],
    ROUTER_ADDRESS[chainId],
    WETH_ADDRESS[chainId]
  );
  console.log("Involica TxHash:", involica.deployTransaction.hash);
  await involica.deployed();
  console.log("Involica deployed to:", involica.address);

  // DEPLOY RESOLVER
  const InvolicaResolverFactory = <InvolicaResolver__factory>(
    await hre.ethers.getContractFactory("InvolicaResolver", signer)
  );
  const resolver = await InvolicaResolverFactory.deploy(
    involica.address,
    ROUTER_ADDRESS[chainId]
  );
  console.log("Resolver TxHash:", resolver.deployTransaction.hash);
  await resolver.deployed();
  console.log("Resolver deployed to:", resolver.address);

  // SET RESOLVER
  await involica.setResolver(resolver.address);
  console.log("Involica resolver set:", resolver.address);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
