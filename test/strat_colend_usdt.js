const { expect } = require("chai");
const { ethers } = require("hardhat");
const ERC20ABI = require("../abis/ERC20.json");
const dotenv = require("dotenv");
dotenv.config({path: __dirname + '/../' + network.name + '.env'})

describe("Colend USDT", async () => {
    let owner = (await ethers.getSigners())[0];
    let admin = (await ethers.getSigners())[3];
    let feeRecipient = (await ethers.getSigners())[4];
    let tester = (await ethers.getSigners())[1];
    let tester2 = (await ethers.getSigners())[2];
    let bitcoin = await ethers.getContractAt(ERC20ABI, process.env.BTC_ADDRESS);
    let usdt = await ethers.getContractAt(ERC20ABI, process.env.USDT_ADDRESS);

    let strategy = ethers.Contract;
    let strategy2 = ethers.Contract;
    let vault = ethers.Contract;

    beforeEach(async () => {

        const deployStrategyImplementation = await ethers.deployContract("FoxerStrategyColend01",
            [],
            {
                signer: owner,
                gasPrice: ethers.parseUnits('1', 'gwei')
            }
        );
        const tx = deployStrategyImplementation.deploymentTransaction();
        await tx.wait();
        await deployStrategyImplementation.waitForDeployment();
        console.log('strategy implementation:', deployStrategyImplementation.target);

        const deployStrategyFactory = await ethers.deployContract("FoxerStrategyColend01Factory",
            [
                deployStrategyImplementation.target
            ],
            {
                signer: owner,
                gasPrice: ethers.parseUnits('1', 'gwei')
            }
        );
        const tx2 = deployStrategyFactory.deploymentTransaction();
        await tx2.wait();
        await deployStrategyFactory.waitForDeployment();
        console.log('strategy factory:', deployStrategyFactory.target);

        const strategyFactory = await ethers.getContractAt("FoxerStrategyColend01Factory", deployStrategyFactory.target);
        const tx3 = await strategyFactory.createClone(
            admin.address,
            process.env.USDT_ADDRESS,
            process.env.BTC_ADDRESS,
            feeRecipient.address,
            50n,
            process.env.COLEND_DATA_PROVIDER_ADDRESS,
            process.env.GLYPH_ROUTER_V2_ADDRESS,
            [ process.env.USDT_ADDRESS, process.env.WCORE_ADDRESS, process.env.BTC_ADDRESS ],
            10000n, // 0.01 USDT minumum swap threshold
            {
                signer: owner,
                gasPrice: ethers.parseUnits('1', 'gwei')
            }
        );
        await tx3.wait();

        // Get latest clone
        const strategyClone = await strategyFactory.latestClone();
        console.log('strategy clone 1:', strategyClone);

        strategy = await ethers.getContractAt("FoxerStrategyColend01", strategyClone);

        const tx4 = await strategyFactory.createClone(
            admin.address,
            process.env.USDT_ADDRESS,
            process.env.BTC_ADDRESS,
            feeRecipient.address,
            50n,
            process.env.COLEND_DATA_PROVIDER_ADDRESS,
            process.env.GLYPH_ROUTER_V2_ADDRESS,
            [ process.env.USDT_ADDRESS, process.env.WCORE_ADDRESS, process.env.BTC_ADDRESS ],
            10000n, // 0.01 USDT minumum swap threshold
            {
                signer: owner,
                gasPrice: ethers.parseUnits('1', 'gwei')
            }
        );
        await tx4.wait();

        // Get latest clone
        const strategyClone2 = await strategyFactory.latestClone();
        console.log('strategy clone 2:', strategyClone2);

        strategy2 = await ethers.getContractAt("FoxerStrategyColend01", strategyClone2);

        console.log('------------------------------------------------');

        const deployVaultImplementation = await ethers.deployContract("FoxerVault",
            [],
            {
                signer: owner,
                gasPrice: ethers.parseUnits('1', 'gwei')
            }
        );
        const tx5 = deployVaultImplementation.deploymentTransaction();
        await tx5.wait();
        await deployVaultImplementation.waitForDeployment();
        console.log('vault implementation:', deployVaultImplementation.target);

        const deployVaultFactory = await ethers.deployContract("FoxerVaultFactory",
            [
                deployVaultImplementation.target
            ],
            {
                signer: owner,
                gasPrice: ethers.parseUnits('1', 'gwei')
            }
        );
        const tx6 = deployVaultFactory.deploymentTransaction();
        await tx6.wait();
        await deployVaultFactory.waitForDeployment();
        console.log('vault factory:', deployVaultFactory.target);

        const vaultFactory = await ethers.getContractAt("FoxerVaultFactory", deployVaultFactory.target);
        const tx7 = await vaultFactory.createClone(
            admin.address,
            process.env.BTC_ADDRESS,
            strategy.target,
            "Foxer USDT (Colend)",
            "fxUSDT",
            0,
            {
                signer: owner,
                gasPrice: ethers.parseUnits('1', 'gwei')
            }
        );
        await tx7.wait();

        // Get latest clone
        const vaultClone = await vaultFactory.latestClone();
        console.log('vault clone:', vaultClone);

        vault = await ethers.getContractAt("FoxerVault", vaultClone);

        // console.log('strategy.setVault...');
        await strategy.connect(admin).setVault(vault.target, {
            gasPrice: ethers.parseUnits('1', 'gwei')
        });

        await strategy2.connect(admin).setVault(vault.target, {
            gasPrice: ethers.parseUnits('1', 'gwei')
        });

    });

    it("should be able to deposit", async () => {
        console.log('strategy:', strategy.target);
        console.log('vault:', vault.target);

        console.log('Send 50 USDT to tester2');
        await usdt.connect(tester).transfer(tester2.address, ethers.parseUnits('50', 6));

        const usdtBalance = await usdt.balanceOf(tester.address);
        console.log('usdtBalance:', ethers.formatUnits(usdtBalance.toString(), 6));

        const usdtBalance2 = await usdt.balanceOf(tester2.address);
        console.log('usdtBalance:', ethers.formatUnits(usdtBalance2.toString(), 6));

        console.log('Approve USDT...');
        await usdt.connect(tester).approve(vault.target, usdtBalance);
        await usdt.connect(tester2).approve(vault.target, usdtBalance2);

        console.log('Deposit 240 USDT...');
        await vault.connect(tester).deposit(usdtBalance, 1000n);

        console.log('Get balance of fxUSDT...');
        const fxUsdtBalance = await vault.balanceOf(tester.address);
        console.log('fxUsdtBalance:', ethers.formatUnits(fxUsdtBalance.toString(), 6));

        const aUSDT = await ethers.getContractAt(ERC20ABI, await strategy.aToken());
        const aUSDTBalance = await aUSDT.balanceOf(strategy.target);
        console.log('aUSDTBalance (strat):', ethers.formatUnits(aUSDTBalance.toString(), 6));

        // Simulate 1 hour wait
        console.log('Simulating wait around 1 year and 15,768,000 blocks...');
        await ethers.provider.send('evm_increaseTime', [86400 * 365]);
        await ethers.provider.send('hardhat_mine', ["0xF099C0"]);

        const aUSDTBalance2 = await aUSDT.balanceOf(strategy.target);
        console.log('aUSDTBalance (strat):', ethers.formatUnits(aUSDTBalance2.toString(), 6));

        // Check available rewards
        console.log('Get available rewards...');
        const rewards = await strategy.estimatedRewardsAvailable();
        console.log('rewards:', ethers.formatUnits(rewards.toString(), 8), 'bitcoin estimated');

        let rd = await vault.accRewardPerShare();
        let rd1 = await vault.userRewardDebt(tester.address);
        let rd2 = await vault.userRewardDebt(tester2.address);
        console.log('* accRewardPerShare       :', ethers.formatUnits(rd.toString(), 12));
        console.log('* userRewardDebt (tester) :', ethers.formatUnits(rd1.toString(), 12));
        console.log('* userRewardDebt (tester2):', ethers.formatUnits(rd2.toString(), 12));

        // Harvest
        console.log('--------------------------');
        console.log('[Tester 1] Harvest...');

        const estimated1 = await vault.estimatedPendingRewards(tester.address);
        console.log('estimated1:', ethers.formatUnits(estimated1.toString(), 8));

        await vault.connect(tester).harvest(1000n);

        const bitcoinBalanceAfter1 = await bitcoin.balanceOf(tester.address);
        console.log('bitcoinBalance after (tester):', ethers.formatUnits(bitcoinBalanceAfter1.toString(), 8));

        rd = await vault.accRewardPerShare();
        rd1 = await vault.userRewardDebt(tester.address);
        rd2 = await vault.userRewardDebt(tester2.address);
        console.log('* accRewardPerShare       :', rd);
        console.log('* userRewardDebt (tester) :', rd1);
        console.log('* userRewardDebt (tester2):', rd2);

        // Simulate 1 hour wait
        console.log('Simulating wait around 1 year and 15,768,000 blocks...');
        await ethers.provider.send('evm_increaseTime', [86400 * 365]);
        await ethers.provider.send('hardhat_mine', ["0xF099C0"]);

        console.log('--------------------------');
        console.log('Propose strategy change...');

        await vault.connect(admin).proposeStrat(strategy2.target);

        console.log('Approve strategy change...');
        await vault.connect(admin).upgradeStrat();

        console.log('Strat changed to:', await vault.strategy());

        console.log('--------------------------');
        console.log('[Tester 2] deposit...');
        await vault.connect(tester2).deposit(usdtBalance2, 1000n);

        const fxUsdtBalance2 = await vault.balanceOf(tester2.address);
        console.log('fxUsdtBalance (tester2):', ethers.formatUnits(fxUsdtBalance2.toString(), 6));

        rd = await vault.accRewardPerShare();
        rd1 = await vault.userRewardDebt(tester.address);
        rd2 = await vault.userRewardDebt(tester2.address);
        console.log('* accRewardPerShare       :', rd);
        console.log('* userRewardDebt (tester) :', rd1);
        console.log('* userRewardDebt (tester2):', rd2);

        // Simulate 1 hour wait
        console.log('Simulating wait around 1 year and 15,768,000 blocks...');
        await ethers.provider.send('evm_increaseTime', [86400 * 365]);
        await ethers.provider.send('hardhat_mine', ["0xF099C0"]);


        const bitcoinBalance = await bitcoin.balanceOf(tester.address);
        console.log('bitcoinBalance (tester):', ethers.formatUnits(bitcoinBalance.toString(), 8));

        const bitcoinBalanceFeeRecipient = await bitcoin.balanceOf(feeRecipient.address);
        console.log('bitcoinBalance (feeRecipient):', ethers.formatUnits(bitcoinBalanceFeeRecipient.toString(), 8));

        const aUSDTBalance3 = await aUSDT.balanceOf(strategy.target);
        console.log('aUSDTBalance (strat):', ethers.formatUnits(aUSDTBalance3.toString(), 6));

        const vaultBalance = await vault.balance();
        console.log('vault balance():', ethers.formatUnits(vaultBalance.toString(), 6));


        rd = await vault.accRewardPerShare();
        rd1 = await vault.userRewardDebt(tester.address);
        rd2 = await vault.userRewardDebt(tester2.address);
        console.log('* accRewardPerShare       :', rd);
        console.log('* userRewardDebt (tester) :', rd1);
        console.log('* userRewardDebt (tester2):', rd2);

        console.log('[Tester 1] Withdraw...');
        await vault.connect(tester).withdraw(fxUsdtBalance, 1000n);

        // Simulate 1 hour wait
        console.log('Simulating wait around 1 year and 15,768,000 blocks...');
        await ethers.provider.send('evm_increaseTime', [86400 * 365]);
        await ethers.provider.send('hardhat_mine', ["0xF099C0"]);

        console.log('--------------------------');
        console.log('[Tester 2] Harvest...');

        const estimated2 = await vault.estimatedPendingRewards(tester2.address);
        console.log('estimated2:', ethers.formatUnits(estimated2.toString(), 8));

        const tester2bitcoinBefore = await bitcoin.balanceOf(tester2.address);
        console.log('bitcoinBalance before (tester2):', ethers.formatUnits(tester2bitcoinBefore.toString(), 8));

        await vault.connect(tester2).harvest(1000n);

        const tester2bitcoinAfter = await bitcoin.balanceOf(tester2.address);
        console.log('bitcoinBalance after (tester2):', ethers.formatUnits(tester2bitcoinAfter.toString(), 8));

        // Simulate 1 hour wait
        console.log('Simulating wait around 1 year and 15,768,000 blocks...');
        await ethers.provider.send('evm_increaseTime', [86400 * 365]);
        await ethers.provider.send('hardhat_mine', ["0xF099C0"]);

        rd = await vault.accRewardPerShare();
        rd1 = await vault.userRewardDebt(tester.address);
        rd2 = await vault.userRewardDebt(tester2.address);
        console.log('* accRewardPerShare       :', rd);
        console.log('* userRewardDebt (tester) :', rd1);
        console.log('* userRewardDebt (tester2):', rd2);

        const usdtBalance3 = await usdt.balanceOf(tester.address);
        console.log('usdtBalance (tester):', ethers.formatUnits(usdtBalance3.toString(), 6));

        // Simulate 1 hour wait
        console.log('Simulating wait around 1 year and 15,768,000 blocks...');
        await ethers.provider.send('evm_increaseTime', [86400 * 365]);
        await ethers.provider.send('hardhat_mine', ["0xF099C0"]);

        console.log('--------------------------');
        // tester 2 withdraw
        const fxUsdtBalance3 = await vault.balanceOf(tester2.address);
        console.log('fxUsdtBalance (tester2):', ethers.formatUnits(fxUsdtBalance3.toString(), 6));

        const vaultTotalSupply = await vault.totalSupply();
        console.log('vaultTotalSupply:', ethers.formatUnits(vaultTotalSupply.toString(), 6));

        const stratTvl = await strategy.tvl();
        console.log('stratTvl:', ethers.formatUnits(stratTvl.toString(), 6));

        const estimatedPendingRewards2 = await vault.estimatedPendingRewards(tester2.address);
        console.log('estimatedPendingRewards (tester2):', ethers.formatUnits(estimatedPendingRewards2.toString(), 8));

        const harvestableRewards = await vault.harvestableRewards(tester2.address);
        console.log('harvestableRewards:', ethers.formatUnits(harvestableRewards.toString(), 8));

        const vaultbitcoinBalance = await bitcoin.balanceOf(vault.target);
        console.log('bitcoinBalance (vault):', ethers.formatUnits(vaultbitcoinBalance.toString(), 8));

        const aTokenBalance = await aUSDT.balanceOf(strategy.target);
        console.log('aTokenBalance (strat):', ethers.formatUnits(aTokenBalance.toString(), 6));

        const usdtBalanceStrat = await usdt.balanceOf(strategy.target);
        console.log('USDT Balance (strat):', ethers.formatUnits(usdtBalanceStrat.toString(), 6));

        rd = await vault.accRewardPerShare();
        rd1 = await vault.userRewardDebt(tester.address);
        rd2 = await vault.userRewardDebt(tester2.address);
        console.log('* accRewardPerShare       :', rd);
        console.log('* userRewardDebt (tester) :', rd1);
        console.log('* userRewardDebt (tester2):', rd2);

        console.log('[Tester 2] Withdraw:', fxUsdtBalance2, 'fxUSDT');
        await vault.connect(tester2).withdraw(fxUsdtBalance2, 1000n);

        const usdtBalance4 = await usdt.balanceOf(tester2.address);
        console.log('usdtBalance (tester2):', ethers.formatUnits(usdtBalance4.toString(), 6));

        const bitcoinBalance2 = await bitcoin.balanceOf(tester2.address);
        console.log('bitcoinBalance (tester2):', ethers.formatUnits(bitcoinBalance2.toString(), 8));

        const aUSDTBalance4 = await aUSDT.balanceOf(strategy.target);
        console.log('aUSDTBalance (strat):', ethers.formatUnits(aUSDTBalance4.toString(), 6));


        expect(strategy).to.be.ok;
        expect(vault).to.be.ok;
    });


});
