import hre from "hardhat";
import {
  OPS_ADDRESS,
  ROUTER_ADDRESS,
  WETH_ADDRESS,
  WETH_SYMBOL,
} from "../constants";
import { PortfolioDCAResolver__factory, PortfolioDCA__factory } from "../typechain";

async function main() {
  const [signer] = await hre.ethers.getSigners();
  const chainId = 137;

  // DEPLOY PORTFOLIO DCA
  const PortfolioDCAFactory = <PortfolioDCA__factory>(
    await hre.ethers.getContractFactory("PortfolioDCA", signer)
  );

  const portfolioDCA = await PortfolioDCAFactory.deploy(
    OPS_ADDRESS[chainId],
    ROUTER_ADDRESS[chainId],
    WETH_ADDRESS[chainId],
    WETH_SYMBOL[chainId]
  );
  console.log("PortfolioDCA TxHash:", portfolioDCA.deployTransaction.hash);
  await portfolioDCA.deployed();
  console.log("PortfolioDCA deployed to:", portfolioDCA.address);

  // DEPLOY RESOLVER
  const PortfolioDCAResolverFactory = <PortfolioDCAResolver__factory>(
    await hre.ethers.getContractFactory("PortfolioDCAResolver", signer)
  );
  const resolver = await PortfolioDCAResolverFactory.deploy(
    portfolioDCA.address,
    ROUTER_ADDRESS[chainId]
  );
  console.log("Resolver TxHash:", resolver.deployTransaction.hash);
  await resolver.deployed();
  console.log("Resolver deployed to:", resolver.address);

  // SET RESOLVER
  await portfolioDCA.setResolver(resolver.address);
  console.log("PortfolioDCA resolver set:", resolver.address);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
