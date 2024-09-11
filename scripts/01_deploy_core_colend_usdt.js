const hre = require("hardhat");
const ethers = hre.ethers;
const network = hre.network;
const upgrades = hre.upgrades;
const dotenv = require("dotenv");
dotenv.config({path: __dirname + '/../' + network.name + '.env'});


async function main() {
    console.log('\x1b[34m%s\x1b[0m', '╔════════════════════════════════════╗');
    console.log('\x1b[34m%s\x1b[0m', '║ deploy FoxerVault CORE Colend USDT ║');
    console.log('\x1b[34m%s\x1b[0m', '╚════════════════════════════════════╝');
    console.log('network: \x1b[34m%s\x1b[0m', network.name);

    const signers = await ethers.getSigners();
    const owner = signers[0];
    const admin = signers[3];
    const feeRecipient = signers[4];

    let strategy = ethers.Contract;
    let vault = ethers.Contract;

    console.log('Deployer......:', owner.address);
    console.log('Admin.........:', admin.address);
    console.log('FeeRecipient..:', feeRecipient.address);

    // ------------------------------------------------------------------------------------
    // Deploy Strategy implementation
    // ------------------------------------------------------------------------------------
    const deployStrategyImplementation = await ethers.deployContract("FoxerStrategyColend01",
        [],
        {
            signer: owner,
            gasPrice: ethers.parseUnits('30', 'gwei')
        }
    );
    const tx = deployStrategyImplementation.deploymentTransaction();
    console.log(tx.hash);
    await tx.wait();
    // await deployStrategyImplementation.waitForDeployment();
    console.log('strategy implementation:', deployStrategyImplementation.target);

    // ------------------------------------------------------------------------------------
    // Deploy Strategy factory
    // ------------------------------------------------------------------------------------
    const deployStrategyFactory = await ethers.deployContract("FoxerStrategyColend01Factory",
        [
            deployStrategyImplementation.target
        ],
        {
            signer: owner,
            gasPrice: ethers.parseUnits('30', 'gwei')
        }
    );
    const tx2 = deployStrategyFactory.deploymentTransaction();
    console.log(tx2.hash);
    await tx2.wait();
    // await deployStrategyFactory.waitForDeployment();
    console.log('strategy factory:', deployStrategyFactory.target);

    // ------------------------------------------------------------------------------------
    // Create Strategy clone
    // ------------------------------------------------------------------------------------
    const strategyFactory = await ethers.getContractAt("FoxerStrategyColend01Factory", deployStrategyFactory.target);
    const tx3 = await strategyFactory.connect(owner).createClone(
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
            signer: owner
        }
    );
    console.log(tx3.hash);
    await tx3.wait();

    // Get latest clone
    const strategyClone = await strategyFactory.latestClone();
    console.log('strategy clone:', strategyClone);

    strategy = await ethers.getContractAt("FoxerStrategyColend01", strategyClone);

    console.log('------------------------------------------------');

    // ------------------------------------------------------------------------------------
    // Create Vault implementation
    // ------------------------------------------------------------------------------------
    const deployVaultImplementation = await ethers.deployContract("FoxerVault",
        [],
        {
            signer: owner
        }
    );
    const tx4 = deployVaultImplementation.deploymentTransaction();
    console.log(tx4.hash);
    await tx4.wait();
    //await deployVaultImplementation.waitForDeployment();
    console.log('vault implementation:', deployVaultImplementation.target);

    // ------------------------------------------------------------------------------------
    // Deploy Vault factory
    // ------------------------------------------------------------------------------------
    const deployVaultFactory = await ethers.deployContract("FoxerVaultFactory",
        [
            deployVaultImplementation.target
        ],
        {
            signer: owner
        }
    );
    const tx5 = deployVaultFactory.deploymentTransaction();
    console.log(tx5.hash);
    await tx5.wait();
    //await deployVaultFactory.waitForDeployment();
    console.log('vault factory:', deployVaultFactory.target);

    // ------------------------------------------------------------------------------------
    // Create Vault clone
    // ------------------------------------------------------------------------------------
    const vaultFactory = await ethers.getContractAt("FoxerVaultFactory", deployVaultFactory.target);
    const tx6 = await vaultFactory.createClone(
        admin.address,
        process.env.BTC_ADDRESS,
        strategy.target,
        "Foxer Colend USDT",
        "fxclUSDT",
        86400n,
        {
            signer: owner
        }
    );
    console.log(tx6.hash);
    await tx6.wait();

    // Get latest clone
    const vaultClone = await vaultFactory.latestClone();
    console.log('vault clone:', vaultClone);

    vault = await ethers.getContractAt("FoxerVault", vaultClone);

    console.log('strategy.setVault("', vault.target, '")...');
    await strategy.connect(admin).setVault(vault.target, {
        // gasPrice: ethers.parseUnits('1', 'gwei')
    });
    console.log('Ready');

    console.log('--------------------------------------');

}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
