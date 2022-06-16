import { ethers } from "hardhat";
import {
  PortfolioDCA,
  PortfolioDCAResolver,
  PortfolioDCAResolver__factory,
  PortfolioDCA__factory,
  IERC20,
  IPokeMe,
  ITaskTreasury,
} from "../../typechain";

import chai from "chai";
import { solidity } from "ethereum-waffle";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
  ETH_TOKEN_ADDRESS,
  GELATO_ADDRESS,
  OPS_ADDRESS,
  ROUTER_ADDRESS,
  TASK_TREASURY_ADDRESS,
  USDC_ADDRESS,
  USDC_DECIMALS,
  WETH_ADDRESS,
} from "../../constants";
import { BigNumber, BigNumberish } from "@ethersproject/bignumber";
import {
  fastForwardTo,
  getCurrentTimestamp,
  impersonateAccount,
  mintUsdc,
} from "../helpers/utils";
import { parseEther, parseUnits } from "@ethersproject/units";

const { expect } = chai;
chai.use(solidity);

// describe("Integration Test: Gelato DCA", function () {
//   let deployer: SignerWithAddress;
//   let alice: SignerWithAddress;
//   let bob: SignerWithAddress;
//   let executor: SignerWithAddress;
//   let deployerAddress: string;
//   let aliceAddress: string;
//   let bobAddress: string;

//   let portfolioDCA: PortfolioDCA;
//   let resolver: PortfolioDCAResolver;
//   let pokeMe: IPokeMe;
//   let taskTreasury: ITaskTreasury;

//   let usdc: IERC20;
//   let weth: IERC20;

//   let defaultFund: BigNumber;
//   let defaultDCA: BigNumber;
//   let defaultSlippage: BigNumber;
//   let defaultInterval: BigNumberish;
//   let defaultGelatoFee: BigNumber;

//   let executeDCAsSelector: string;
//   let resolverData: string;
//   let resolverHash: string;

//   let snapshotId: string;
//   const chainId = 1;

//   before("setup contracts", async () => {
//     [deployer, alice, bob] = await ethers.getSigners();
//     deployerAddress = deployer.address;
//     aliceAddress = alice.address;
//     bobAddress = bob.address;

//     defaultFund = parseUnits("3000", USDC_DECIMALS);
//     defaultDCA = defaultFund.div(3);
//     defaultInterval = 60; // second;
//     defaultGelatoFee = parseEther("0.05");

//     usdc = <IERC20>await ethers.getContractAt("IERC20", USDC_ADDRESS[chainId]);
//     weth = <IERC20>await ethers.getContractAt("IERC20", WETH_ADDRESS[chainId]);

//     const PortfolioDCAFactory = (await ethers.getContractFactory(
//       "PortfolioDCA",
//       deployer
//     )) as PortfolioDCA__factory;
//     portfolioDCA = await PortfolioDCAFactory.deploy(
//       ROUTER_ADDRESS[chainId],
//       OPS_ADDRESS[chainId],
//       weth.address
//     );
//     await portfolioDCA.deployed();
//     defaultSlippage = await portfolioDCA.minSlippage();

//     const PortfolioDCAResolverFactory = (await ethers.getContractFactory(
//       "PortfolioDCAResolver",
//       deployer
//     )) as PortfolioDCAResolver__factory;
//     resolver = await PortfolioDCAResolverFactory.deploy(
//       portfolioDCA.address,
//       ROUTER_ADDRESS[chainId]
//     );
//     await resolver.deployed();

//     pokeMe = <IPokeMe>(
//       await ethers.getContractAt("IPokeMe", OPS_ADDRESS[chainId])
//     );
//     taskTreasury = <ITaskTreasury>(
//       await ethers.getContractAt(
//         "ITaskTreasury",
//         TASK_TREASURY_ADDRESS[chainId]
//       )
//     );
//     await taskTreasury
//       .connect(deployer)
//       .depositFunds(deployerAddress, ETH_TOKEN_ADDRESS, 0, {
//         value: parseEther("1"),
//       });

//     await portfolioDCA
//       .connect(deployer)
//       .setAllowedTokenPair(usdc.address, weth.address, true);

//     await mintUsdc(defaultFund.mul(10), aliceAddress);
//     await mintUsdc(defaultFund.mul(10), bobAddress);

//     await usdc
//       .connect(alice)
//       .approve(portfolioDCA.address, ethers.constants.MaxUint256);
//     await usdc
//       .connect(bob)
//       .approve(portfolioDCA.address, ethers.constants.MaxUint256);

//     executor = await impersonateAccount(GELATO_ADDRESS[chainId]);

//     executeDCAsSelector = portfolioDCA.interface.getSighash("executeDCAs");
//     resolverData = resolver.interface.encodeFunctionData(
//       "getExecutablePositions"
//     );
//     resolverHash = await pokeMe.getResolverHash(resolver.address, resolverData);

//     await pokeMe
//       .connect(deployer)
//       .createTask(
//         portfolioDCA.address,
//         executeDCAsSelector,
//         resolver.address,
//         resolverData
//       );

//     snapshotId = await ethers.provider.send("evm_snapshot", []);
//   });

//   beforeEach(async () => {
//     await ethers.provider.send("evm_revert", [snapshotId]);
//     snapshotId = await ethers.provider.send("evm_snapshot", []);
//   });

//   describe("Gelato DCA", async () => {
//     it("should DCA until funds run out", async () => {
//       const positionId = await getNextPositionId(portfolioDCA);
//       await portfolioDCA
//         .connect(alice)
//         .setPosition(
//           usdc.address,
//           weth.address,
//           defaultFund,
//           defaultDCA,
//           defaultInterval,
//           defaultSlippage
//         );

//       const balanceBeforeUsdc = await usdc.balanceOf(portfolioDCA.address);
//       const balanceBeforeWeth = await weth.balanceOf(portfolioDCA.address);

//       let hasFunds = true;
//       while (hasFunds) {
//         const [canExec, payload] = await resolver.getExecutablePositions();
//         expect(canExec).to.be.eq(true);

//         const tx = await pokeMe
//           .connect(executor)
//           .exec(
//             defaultGelatoFee,
//             ETH_TOKEN_ADDRESS,
//             deployerAddress,
//             true,
//             resolverHash,
//             portfolioDCA.address,
//             payload
//           );
//         expect(tx).to.emit(portfolioDCA, "ExecuteDCA").withArgs(positionId);

//         const now = await getCurrentTimestamp();
//         await fastForwardTo(now.add(defaultInterval).toNumber());

//         const position = await portfolioDCA.positions(positionId);
//         if (position[4].lt(position[6])) {
//           hasFunds = false;
//         }
//       }

//       const balanceAfterUsdc = await usdc.balanceOf(portfolioDCA.address);
//       const balanceAfterWeth = await weth.balanceOf(portfolioDCA.address);

//       expect(balanceBeforeUsdc.sub(balanceAfterUsdc)).to.be.eq(defaultFund);
//       expect(balanceAfterWeth.sub(balanceBeforeWeth)).to.be.gt(0);
//     });
//     it("should continue DCA if inactive position gets new deposit", async () => {
//       const positionId = await getNextPositionId(portfolioDCA);
//       await portfolioDCA
//         .connect(alice)
//         .setPosition(
//           usdc.address,
//           weth.address,
//           defaultDCA,
//           defaultDCA,
//           defaultInterval,
//           defaultSlippage
//         );

//       const [canExec, payload] = await resolver.getExecutablePositions();
//       expect(canExec).to.be.eq(true);
//       const tx1 = await pokeMe
//         .connect(executor)
//         .exec(
//           defaultGelatoFee,
//           ETH_TOKEN_ADDRESS,
//           deployerAddress,
//           true,
//           resolverHash,
//           portfolioDCA.address,
//           payload
//         );
//       expect(tx1).to.emit(portfolioDCA, "ExecuteDCA").withArgs(positionId);

//       const positionPre = await portfolioDCA.positions(positionId);
//       expect(positionPre[4]).to.be.eq(0); // fund left

//       const now = await getCurrentTimestamp();
//       await fastForwardTo(now.add(defaultInterval).toNumber());

//       const [canExec2] = await resolver.getExecutablePositions();
//       expect(canExec2).to.be.eq(false);

//       await portfolioDCA.connect(alice).deposit(positionId, defaultDCA);

//       const [canExec3, payload3] = await resolver.getExecutablePositions();
//       expect(canExec3).to.be.eq(true);

//       const tx2 = await pokeMe
//         .connect(executor)
//         .exec(
//           defaultGelatoFee,
//           ETH_TOKEN_ADDRESS,
//           deployerAddress,
//           true,
//           resolverHash,
//           portfolioDCA.address,
//           payload3
//         );
//       expect(tx2).to.emit(portfolioDCA, "ExecuteDCA").withArgs(positionId);

//       const positionPost = await portfolioDCA.positions(positionId);
//       expect(positionPost[5]).to.be.gt(positionPre[5]);
//     });

//     it("should DCA each position according to interval", async () => {
//       const positionId1 = await getNextPositionId(portfolioDCA);
//       await portfolioDCA
//         .connect(alice)
//         .setPosition(
//           usdc.address,
//           weth.address,
//           defaultFund,
//           defaultDCA,
//           200,
//           defaultSlippage
//         );

//       const positionId2 = await getNextPositionId(portfolioDCA);
//       await portfolioDCA
//         .connect(bob)
//         .setPosition(
//           usdc.address,
//           weth.address,
//           defaultFund,
//           defaultDCA,
//           400,
//           defaultSlippage
//         );

//       const [canExec1, payload1] = await resolver.getExecutablePositions();
//       expect(canExec1).to.be.eq(true);
//       const tx1 = await pokeMe
//         .connect(executor)
//         .exec(
//           defaultGelatoFee,
//           ETH_TOKEN_ADDRESS,
//           deployerAddress,
//           true,
//           resolverHash,
//           portfolioDCA.address,
//           payload1
//         );
//       expect(tx1).to.emit(portfolioDCA, "ExecuteDCA").withArgs(positionId1);
//       expect(tx1).to.emit(portfolioDCA, "ExecuteDCA").withArgs(positionId2);

//       let now = await getCurrentTimestamp();
//       await fastForwardTo(now.add(200).toNumber());

//       const [canExec2, payload2] = await resolver.getExecutablePositions();
//       expect(canExec2).to.be.eq(true);
//       const tx2 = await pokeMe
//         .connect(executor)
//         .exec(
//           defaultGelatoFee,
//           ETH_TOKEN_ADDRESS,
//           deployerAddress,
//           true,
//           resolverHash,
//           portfolioDCA.address,
//           payload2
//         );
//       expect(tx2).to.emit(portfolioDCA, "ExecuteDCA").withArgs(positionId1);

//       now = await getCurrentTimestamp();
//       await fastForwardTo(now.add(200).toNumber());

//       const [canExec3, paylod3] = await resolver.getExecutablePositions();
//       expect(canExec3).to.be.eq(true);
//       const tx3 = await pokeMe
//         .connect(executor)
//         .exec(
//           defaultGelatoFee,
//           ETH_TOKEN_ADDRESS,
//           deployerAddress,
//           true,
//           resolverHash,
//           portfolioDCA.address,
//           paylod3
//         );
//       expect(tx3).to.emit(portfolioDCA, "ExecuteDCA").withArgs(positionId1);
//       expect(tx3).to.emit(portfolioDCA, "ExecuteDCA").withArgs(positionId2);
//     });
//   });
// });
