import hre from "hardhat";
import { CORE_ADDRESS } from "../constants";
import { Involica } from "../typechain";

async function main() {
  const [signer] = await hre.ethers.getSigners();
  const chainId = 250;

  const DCA_CORE_ADDRESS = CORE_ADDRESS[chainId];

  const tokens = [
    { token: "", allowed: true },
    { token: "", allowed: true },
    { token: "", allowed: true },
    { token: "", allowed: true },
    { token: "", allowed: true },
    { token: "", allowed: true },
  ]

  const addresses = tokens.map((token) => token.token)
  const alloweds = tokens.map((token) => token.allowed)

  const involica = <Involica>(
    await hre.ethers.getContractAt("Involica", DCA_CORE_ADDRESS)
  );

  const tx = await involica
    .connect(signer)
    .setAllowedTokens(addresses, alloweds)
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
