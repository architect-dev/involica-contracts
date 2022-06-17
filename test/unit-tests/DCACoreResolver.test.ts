import { ethers, network } from "hardhat";
import {
  PortfolioDCA,
  PortfolioDCAResolver,
  PortfolioDCAResolver__factory,
  PortfolioDCA__factory,
  IERC20,
} from "../../typechain";

import chai from "chai";
import { solidity } from "ethereum-waffle";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
  ETH_TOKEN_ADDRESS,
  OPS_ADDRESS,
  ROUTER_ADDRESS,
  USDC_ADDRESS,
  USDC_DECIMALS,
  WBTC_ADDRESS,
  WETH_ADDRESS,
  WETH_SYMBOL,
} from "../../constants";
import { BigNumber, BigNumberish } from "@ethersproject/bignumber";
import {
  mintUsdc,
  parseGwei,
} from "../helpers/utils";
import { parseUnits } from "@ethersproject/units";
import { Contract } from "ethers/lib/ethers";
import { parseEther, toUtf8String } from "ethers/lib/utils";

const { expect } = chai;
chai.use(solidity);

describe("PortfolioDCAResolver", function () {
  let deployer: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let deployerAddress: string;
  let aliceAddress: string;
  let bobAddress: string;

  let ops: SignerWithAddress;
  let opsAddress: string;

  let portfolioDCA: PortfolioDCA;
  let resolver: PortfolioDCAResolver;
  let uniRouter: Contract;

  let usdc: IERC20;
  let weth: IERC20;
  let wbtc: IERC20;

  let defaultTreasuryFund: BigNumber;
  let defaultFund: BigNumber;
  let defaultEtherFund: BigNumber;
  let defaultDCA: BigNumber;
  let defaultEtherDCA: BigNumber;
  let defaultInterval: BigNumberish;
  let defaultGasPrice: BigNumberish
  let defaultSlippage: BigNumber;
  let usdcSwapRoute: string[];
  let wethSwapRoute: string[];
  let wbtcSwapRoute: string[];

  let snapshotId: string;
  const chainId = 250;

  before("setup contracts", async () => {
    [deployer, alice, bob] = await ethers.getSigners();
    deployerAddress = deployer.address;
    aliceAddress = alice.address;
    bobAddress = bob.address;

    usdc = <IERC20>await ethers.getContractAt("IERC20", USDC_ADDRESS[chainId]);
    weth = <IERC20>await ethers.getContractAt("IERC20", WETH_ADDRESS[chainId]);
    wbtc = <IERC20>await ethers.getContractAt("IERC20", WBTC_ADDRESS[chainId]);

    defaultTreasuryFund = parseEther("0.5");
    defaultFund = parseUnits("10000", USDC_DECIMALS);
    defaultEtherFund = parseEther("1000")
    defaultDCA = defaultFund.div(10);
    defaultEtherDCA = defaultEtherFund.div(10);
    defaultInterval = 60; // second;
    usdcSwapRoute = [weth.address, usdc.address];
    wethSwapRoute = [usdc.address, weth.address];
    wbtcSwapRoute = [usdc.address, weth.address, wbtc.address];
    defaultGasPrice = 100;

    const PortfolioDCAFactory = (await ethers.getContractFactory(
      "PortfolioDCA",
      deployer
    )) as PortfolioDCA__factory;
    portfolioDCA = await PortfolioDCAFactory.deploy(
      OPS_ADDRESS[chainId],
      ROUTER_ADDRESS[chainId],
      weth.address,
      WETH_SYMBOL[chainId]
    );
    await portfolioDCA.deployed();
    defaultSlippage = await portfolioDCA.minSlippage();

    const PortfolioDCAResolverFactory = (await ethers.getContractFactory(
      "PortfolioDCAResolver",
      deployer
    )) as PortfolioDCAResolver__factory;
    resolver = await PortfolioDCAResolverFactory.deploy(
      portfolioDCA.address,
      ROUTER_ADDRESS[chainId]
    );
    await resolver.deployed();

    await portfolioDCA.connect(deployer).setResolver(resolver.address)

    uniRouter = await ethers.getContractAt(
      "IUniswapV2Router",
      ROUTER_ADDRESS[chainId]
    );

    await portfolioDCA
      .connect(deployer)
      .setAllowedTokens(
        [usdc.address, wbtc.address],
        ['USDC', 'wBTC'], 
        [true, true]
      );

    await mintUsdc(chainId, defaultFund.mul(10), aliceAddress);
    await mintUsdc(chainId, defaultFund.mul(10), bobAddress);

    await usdc
      .connect(alice)
      .approve(portfolioDCA.address, ethers.constants.MaxUint256);
    await usdc
      .connect(bob)
      .approve(portfolioDCA.address, ethers.constants.MaxUint256);

    // Impersonate ops
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [OPS_ADDRESS[chainId]],
    });
  
    ops = await ethers.getSigner(OPS_ADDRESS[chainId]);
    opsAddress = ops.address

    // Fund ops
    await network.provider.send("hardhat_setBalance", [
      opsAddress,
      parseEther('1')._hex.replace("0x0", "0x"),
    ]);

    snapshotId = await ethers.provider.send("evm_snapshot", []);
  });

  beforeEach(async () => {
    await ethers.provider.send("evm_revert", [snapshotId]);
    snapshotId = await ethers.provider.send("evm_snapshot", []);
  });


  describe.only("checkPositionExecutable()", async () => {
    beforeEach(async () => {
      await portfolioDCA
        .connect(alice)
        .setPosition(
          defaultTreasuryFund,
          usdc.address,
          [{
            token: weth.address,
            weight: 5000,
            route: wethSwapRoute,
            maxSlippage: defaultSlippage
          }, {
            token: wbtc.address,
            weight: 5000,
            route: wbtcSwapRoute,
            maxSlippage: defaultSlippage
          }],
          defaultFund,
          defaultDCA,
          defaultInterval,
          defaultGasPrice,
          { value: defaultTreasuryFund }
        )
      await portfolioDCA
        .connect(bob)
        .setPosition(
          defaultTreasuryFund,
          ETH_TOKEN_ADDRESS,
          [{
            token: usdc.address,
            weight: 10000,
            route: usdcSwapRoute,
            maxSlippage: defaultSlippage
          }],
          0,
          defaultEtherDCA,
          defaultInterval,
          defaultGasPrice,
          { value: defaultTreasuryFund.add(defaultEtherFund) }
        );
    });
    it("should return false if user doesnt have position", async () => {
      await portfolioDCA.connect(alice).exitPosition()

      const [canExec, payload] = await resolver.checkPositionExecutable(alice.address);
      expect(canExec).to.be.eq(false);
      
      expect(toUtf8String(payload)).to.be.eq("User doesnt have a position");
    })
    it("should return false if user position not mature", async () => {
      await portfolioDCA.connect(ops).executeDCA(aliceAddress, [0, 0]);

      const [canExec, payload] = await resolver.checkPositionExecutable(alice.address);
      expect(canExec).to.be.eq(false);
      
      expect(toUtf8String(payload)).to.be.eq("DCA not mature");
    })
    it("should return false if gas price is too expensive", async () => {
      const [canExec, payload] = await resolver.checkPositionExecutable(alice.address, { gasPrice: parseGwei(defaultGasPrice).mul(2) });
      expect(canExec).to.be.eq(false);
      
      expect(toUtf8String(payload)).to.be.eq("Gas too expensive");
    })
    it("should return true if position is ready", async () => {
      const [canExec] = await resolver.checkPositionExecutable(alice.address);
      expect(canExec).to.be.eq(true);
    })
    it("should return correct swapsAmountOutMins", async () => {
      const [canExec, payload] = await resolver.checkPositionExecutable(alice.address);
      expect(canExec).to.be.eq(true);

      const wethAmounts = await uniRouter.getAmountsOut(
        defaultDCA.mul(5000).div(10000),
        wethSwapRoute
      );
      const wbtcAmounts = await uniRouter.getAmountsOut(
        defaultDCA.mul(5000).div(10000),
        wbtcSwapRoute
      );

      const wethAmountOutMin: BigNumber = wethAmounts[wethAmounts.length - 1]
        .mul(BigNumber.from(10000).sub(defaultSlippage)).div(10000);
      const wbtcAmountOutMin: BigNumber = wbtcAmounts[wbtcAmounts.length - 1]
        .mul(BigNumber.from(10000).sub(defaultSlippage)).div(10000);

      const taskData = portfolioDCA.interface.encodeFunctionData("executeDCA", [
        alice.address,
        [wethAmountOutMin, wbtcAmountOutMin],
      ]);

      expect(payload).to.be.eq(taskData);
    })
    it("should return correct swapsAmountOutMins ETH", async () => {
      const [canExec, payload] = await resolver.checkPositionExecutable(bob.address);
      expect(canExec).to.be.eq(true);

      const usdcAmounts = await uniRouter.getAmountsOut(
        defaultEtherDCA,
        usdcSwapRoute
      );

      const usdcAmountOutMin: BigNumber = usdcAmounts[usdcAmounts.length - 1]
        .mul(BigNumber.from(10000).sub(defaultSlippage)).div(10000);

      const taskData = portfolioDCA.interface.encodeFunctionData("executeDCA", [
        bob.address,
        [usdcAmountOutMin],
      ]);

      expect(payload).to.be.eq(taskData);
    })
    it("executeDCA should succeed with swapsAmountOutMins", async () => {
      const [canExec, payload] = await resolver.checkPositionExecutable(alice.address);
      expect(canExec).to.be.eq(true);

      const wethAmounts = await uniRouter.getAmountsOut(
        defaultDCA.mul(5000).div(10000),
        wethSwapRoute
      );
      const wbtcAmounts = await uniRouter.getAmountsOut(
        defaultDCA.mul(5000).div(10000),
        wbtcSwapRoute
      );

      const wethAmountOutMin: BigNumber = wethAmounts[wethAmounts.length - 1]
        .mul(BigNumber.from(10000).sub(defaultSlippage)).div(10000);
      const wbtcAmountOutMin: BigNumber = wbtcAmounts[wbtcAmounts.length - 1]
        .mul(BigNumber.from(10000).sub(defaultSlippage)).div(10000);

      const taskData = portfolioDCA.interface.encodeFunctionData("executeDCA", [
        alice.address,
        [wethAmountOutMin, wbtcAmountOutMin],
      ]);

      expect(payload).to.be.eq(taskData)

      const tx = await ops.sendTransaction({
        to: portfolioDCA.address,
        data: taskData
      })

      expect(tx).to.emit(portfolioDCA, "ExecuteDCA").withArgs(alice.address)
    })
  })
});
