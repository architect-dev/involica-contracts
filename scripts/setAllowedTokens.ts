import hre from "hardhat";
import { CORE_ADDRESS, WETH_ADDRESS, WETH_SYMBOL } from "../constants";
import { PortfolioDCA } from "../typechain";

async function main() {
  const [signer] = await hre.ethers.getSigners();
  const chainId = 250;

  const DCA_CORE_ADDRESS = CORE_ADDRESS[chainId];

  const tokens = [
    { token: "", symbol: WETH_SYMBOL[chainId], allowed: true },
    { token: "", symbol: 'USDC', allowed: true },
    { token: "", symbol: 'MIM', allowed: true },
    { token: "", symbol: 'wBTC', allowed: true },
    { token: "", symbol: 'wETH', allowed: true },
    { token: "", symbol: 'wBNB', allowed: true },
  ]

  const addresses = tokens.map((token) => token.token)
  const symbols = tokens.map((token) => token.symbol)
  const alloweds = tokens.map((token) => token.allowed)

  const portfolioDCA = <PortfolioDCA>(
    await hre.ethers.getContractAt("PortfolioDCA", DCA_CORE_ADDRESS)
  );

  const tx = await portfolioDCA
    .connect(signer)
    .setAllowedTokens(addresses, symbols, alloweds)
  console.log(tx.hash);
  await tx.wait();

  console.log("CONFIRMED");
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
