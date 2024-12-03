const hre = require("hardhat");
const ethers = hre.ethers;
const network = hre.network;
const upgrades = hre.upgrades;
const dotenv = require("dotenv");
const ERC20ABI = require("../abis/ERC20.json");
dotenv.config({path: __dirname + '/../' + network.name + '.env'});


async function main() {
    console.log('\x1b[34m%s\x1b[0m', '╔════════════════════════════════════╗');
    console.log('\x1b[34m%s\x1b[0m', '║ deploy FoxerVault CORE Colend USDC ║');
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

    const coreBTC = await ethers.getContractAt(ERC20ABI, process.env.BTC_ADDRESS);
    const USDT = await ethers.getContractAt(ERC20ABI, process.env.USDT_ADDRESS);
    const USDC = await ethers.getContractAt(ERC20ABI, process.env.USDC_ADDRESS);
    const WCORE = await ethers.getContractAt(ERC20ABI, process.env.WCORE_ADDRESS);

    // ------------------------------------------------------------------------------------
    // Deploy Strategy
    // ------------------------------------------------------------------------------------
    const deployStrategyImplementation = await ethers.deployContract("FoxerStrategyColend02",
        [
            admin.address,
            USDC.target,
            coreBTC.target,
            feeRecipient.address,
            50,
            process.env.COLEND_DATA_PROVIDER_ADDRESS,
            process.env.GLYPH_ROUTER_V4_ADDRESS,
            10000n, // 0.01 USDC minumum swap threshold
        ],
        {
            signer: owner,
            gasPrice: ethers.parseUnits('30', 'gwei')
        }
    );
    const tx = deployStrategyImplementation.deploymentTransaction();
    console.log(tx.hash);
    await tx.wait();
    // await deployStrategyImplementation.waitForDeployment();
    console.log('strategy:', deployStrategyImplementation.target);
    strategy = await ethers.getContractAt("FoxerStrategyColend02", deployStrategyImplementation.target);

    console.log('------------------------------------------------');

    // ------------------------------------------------------------------------------------
    // Create Vault
    // ------------------------------------------------------------------------------------
    const deployVaultImplementation = await ethers.deployContract("FoxerVaultV2",
        [
            admin.address,
            coreBTC.target,
            strategy.target,
            "Foxer USDC",
            "fxUSDC",
            86400,
        ],
        {
            signer: owner
        }
    );
    const tx4 = deployVaultImplementation.deploymentTransaction();
    console.log(tx4.hash);
    await tx4.wait();
    //await deployVaultImplementation.waitForDeployment();
    console.log('vault:', deployVaultImplementation.target);

    vault = await ethers.getContractAt("FoxerVaultV2", deployVaultImplementation.target);

    console.log('strategy.setVault("', vault.target, '")...');
    await strategy.connect(admin).setVault(vault.target, {
        // gasPrice: ethers.parseUnits('1', 'gwei')
    });

    console.log('strategy.setSwapHops(...)');
    const tx5 = await strategy.connect(admin).setSwapHops(
        [ USDC.target, USDT.target, WCORE.target, coreBTC.target ],
        {
            gasPrice: ethers.parseUnits('30', 'gwei'),
        }
    );
    await tx5.wait();

    console.log('Ready');

    console.log('--------------------------------------');
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
