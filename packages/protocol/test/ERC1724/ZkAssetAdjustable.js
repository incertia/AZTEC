/* global artifacts, expect, contract, beforeEach, it:true */
const { JoinSplitProof, MintProof, BurnProof, note, signer } = require('aztec.js');
const devUtils = require('@aztec/dev-utils');
const secp256k1 = require('@aztec/secp256k1');
const BN = require('bn.js');
const truffleAssert = require('truffle-assertions');

const { JOIN_SPLIT_PROOF, MINT_PROOF, BURN_PROOF } = devUtils.proofs;

const ACE = artifacts.require('./ACE');
const ERC20Mintable = artifacts.require('./ERC20Mintable');
const JoinSplitValidator = artifacts.require('./JoinSplit');
const JoinSplitValidatorInterface = artifacts.require('./JoinSplitInterface');
const JoinSplitFluidValidator = artifacts.require('./JoinSplitFluid');
const JoinSplitFluidValidatorInterface = artifacts.require('./JoinSplitFluidInterface');
const ZkAssetAdjustable = artifacts.require('./ZkAssetAdjustable');

const helpers = require('../helpers/ERC1724');

JoinSplitValidator.abi = JoinSplitValidatorInterface.abi;
JoinSplitFluidValidator.abi = JoinSplitFluidValidatorInterface.abi;

const aztecAccount = secp256k1.generateAccount();
const { publicKey } = aztecAccount;

const getDefaultMintNotes = async () => {
    const newMintCounter = 50;
    const mintedNoteValues = [20, 30];

    const zeroMintCounterNote = await note.createZeroValueNote();
    const newMintCounterNote = await note.create(publicKey, newMintCounter);
    const mintedNotes = await Promise.all(mintedNoteValues.map((mintedValue) => note.create(publicKey, mintedValue)));
    return { zeroMintCounterNote, newMintCounterNote, mintedNotes };
};

const getCustomMintNotes = async (newMintCounterValue, mintedNoteValues) => {
    const zeroMintCounterNote = await note.createZeroValueNote();
    const newMintCounterNote = await note.create(publicKey, newMintCounterValue);
    const mintedNotes = await Promise.all(mintedNoteValues.map((mintedValue) => note.create(publicKey, mintedValue)));
    return { zeroMintCounterNote, newMintCounterNote, mintedNotes };
};

const confidentialApprove = async (zkAssetAdjustable, delegateAddress, indexes, notes, ownerAccount) => {
    const spenderApproval = true;
    await Promise.all(
        indexes.map((i) => {
            const signature = signer.signNoteForConfidentialApprove(
                zkAssetAdjustable.address,
                notes[i].noteHash,
                delegateAddress,
                spenderApproval,
                ownerAccount.privateKey,
            );
            // eslint-disable-next-line no-await-in-loop
            return zkAssetAdjustable.confidentialApprove(notes[i].noteHash, delegateAddress, true, signature);
        }),
    );
};

contract('ZkAssetAdjustable', (accounts) => {
    describe('Success States', () => {
        let ace;
        let erc20;
        let scalingFactor;
        const publicOwner = accounts[0];

        beforeEach(async () => {
            ace = await ACE.at(ACE.address);
            erc20 = await ERC20Mintable.new({ from: accounts[0] });

            erc20 = await ERC20Mintable.new();
            scalingFactor = new BN(10);
        });

        it('should complete a mint operation', async () => {
            const zkAssetAdjustable = await ZkAssetAdjustable.new(ace.address, erc20.address, scalingFactor, 0, [], {
                from: accounts[0],
            });

            const sender = accounts[0];
            const { zeroMintCounterNote, newMintCounterNote, mintedNotes } = await getDefaultMintNotes();
            const proof = new MintProof(zeroMintCounterNote, newMintCounterNote, mintedNotes, sender);
            const data = proof.encodeABI();
            const { receipt } = await zkAssetAdjustable.confidentialMint(MINT_PROOF, data, { from: accounts[0] });
            expect(receipt.status).to.equal(true);
        });

        it('should transfer minted value out of the note registry', async () => {
            const zkAssetAdjustable = await ZkAssetAdjustable.new(ace.address, erc20.address, scalingFactor, 0, [], {
                from: accounts[0],
            });

            const withdrawalPublicValue = 50;
            const erc20TotalSupply = (await erc20.totalSupply()).toNumber();
            expect(erc20TotalSupply).to.equal(0);
            const initialBalance = (await erc20.balanceOf(accounts[1])).toNumber();

            const mintSender = accounts[0];
            const { zeroMintCounterNote, newMintCounterNote, mintedNotes } = await getDefaultMintNotes();

            const proof = new MintProof(zeroMintCounterNote, newMintCounterNote, mintedNotes, mintSender);
            const data = proof.encodeABI();
            const { receipt: mintReceipt } = await zkAssetAdjustable.confidentialMint(MINT_PROOF, data);
            expect(mintReceipt.status).to.equal(true);

            const erc20TotalSupplyAfterMint = (await erc20.totalSupply()).toNumber();
            expect(erc20TotalSupplyAfterMint).to.equal(0);

            const withdrawSender = accounts[0];

            const withdrawalProof = new JoinSplitProof(mintedNotes, [], withdrawSender, withdrawalPublicValue, publicOwner);
            const withdrawalData = withdrawalProof.encodeABI(zkAssetAdjustable.address);
            const withdrawalSignatures = withdrawalProof.constructSignatures(zkAssetAdjustable.address, [
                aztecAccount,
                aztecAccount,
            ]);
            const { receipt: transferReceipt } = await zkAssetAdjustable.methods['confidentialTransfer(bytes,bytes)'](
                withdrawalData,
                withdrawalSignatures,
            );

            const erc20TotalSupplyAfterWithdrawal = (await erc20.totalSupply()).toNumber();
            expect(erc20TotalSupplyAfterWithdrawal).to.equal(withdrawalPublicValue * scalingFactor);
            const finalBalance = (await erc20.balanceOf(accounts[0])).toNumber();
            expect(transferReceipt.status).to.equal(true);
            expect(initialBalance).to.equal(0);
            expect(finalBalance).to.equal(withdrawalPublicValue * scalingFactor);
        });

        it('should burn minted notes', async () => {
            const zkAssetAdjustable = await ZkAssetAdjustable.new(ace.address, erc20.address, scalingFactor, 0, [], {
                from: accounts[0],
            });

            const sender = accounts[0];
            const mintValue = 50;
            const mintNotes = [20, 30];
            const { zeroMintCounterNote, newMintCounterNote, mintedNotes } = await getCustomMintNotes(mintValue, mintNotes);
            const proof = new MintProof(zeroMintCounterNote, newMintCounterNote, mintedNotes, sender);
            const data = proof.encodeABI();
            await zkAssetAdjustable.confidentialMint(MINT_PROOF, data, { from: accounts[0] });

            const [burnSender] = accounts;
            const newBurnCounterNote = await note.create(aztecAccount.publicKey, mintValue);
            const zeroBurnCounterNote = await note.createZeroValueNote();
            const burnProof = new BurnProof(zeroBurnCounterNote, newBurnCounterNote, mintedNotes, burnSender);
            const burnData = burnProof.encodeABI(zkAssetAdjustable.address);

            const { receipt: burnReceipt } = await zkAssetAdjustable.confidentialBurn(BURN_PROOF, burnData);
            expect(burnReceipt.status).to.equal(true);
        });

        it('should perform mint when using confidentialTransferFrom()', async () => {
            const zkAssetAdjustable = await ZkAssetAdjustable.new(ace.address, erc20.address, scalingFactor, 0, [], {
                from: accounts[0],
            });

            const { zeroMintCounterNote, newMintCounterNote, mintedNotes } = await getDefaultMintNotes();
            const delegateAddress = accounts[2];

            const erc20TotalSupply = (await erc20.totalSupply()).toNumber();
            const initialAceBalance = (await erc20.balanceOf(ace.address)).toNumber();
            const initialRecipientBalance = (await erc20.balanceOf(accounts[1])).toNumber();
            expect(initialAceBalance).to.equal(0);
            expect(erc20TotalSupply).to.equal(0);
            expect(initialRecipientBalance).to.equal(0);

            const mintSender = accounts[0];
            const proof = new MintProof(zeroMintCounterNote, newMintCounterNote, mintedNotes, mintSender);
            const data = proof.encodeABI();
            const { receipt: mintReceipt } = await zkAssetAdjustable.confidentialMint(MINT_PROOF, data);
            expect(mintReceipt.status).to.equal(true);
            const erc20TotalSupplyAfterMint = (await erc20.totalSupply()).toNumber();
            expect(erc20TotalSupplyAfterMint).to.equal(0);

            await confidentialApprove(zkAssetAdjustable, delegateAddress, [0, 1], mintedNotes, aztecAccount);
            const withdrawalPublicOwner = accounts[3];
            const withdrawalPublicValue = 50;

            // create a proof, that withdraws more tokens than the ACE contract holds
            const withdrawalProof = new JoinSplitProof(
                mintedNotes, // 20 + 30
                [],
                delegateAddress,
                withdrawalPublicValue,
                withdrawalPublicOwner,
            );
            const withdrawalData = withdrawalProof.encodeABI(zkAssetAdjustable.address);
            await ace.validateProof(JOIN_SPLIT_PROOF, accounts[2], withdrawalData, { from: delegateAddress });
            const { receipt: transferReceipt } = await zkAssetAdjustable.confidentialTransferFrom(
                JOIN_SPLIT_PROOF,
                withdrawalProof.eth.output,
                { from: delegateAddress },
            );
            expect(transferReceipt.status).to.equal(true);

            const erc20TotalSupplyAfterWithdrawal = (await erc20.totalSupply()).toNumber();
            const finalRecipientBalance = (await erc20.balanceOf(withdrawalPublicOwner)).toNumber();
            const finalAceBalance = (await erc20.balanceOf(ace.address)).toNumber();
            expect(erc20TotalSupplyAfterWithdrawal).to.equal(withdrawalPublicValue * scalingFactor);
            expect(finalRecipientBalance).to.equal(withdrawalPublicValue * scalingFactor);
            expect(finalAceBalance).to.equal(0);
        });

        // eslint-disable-next-line max-len
        it('should not mint and not call supplementTokens() ACE has insufficient number of tokens when using confidentialTransferFrom()', async () => {
            // first, creating a deposit proof to convert 50 tokens into notes
            // second, creating a withdraw proof to convert the same 50 tokens back into notes - using confidentialTransferFrom()
            // ensuring that no extra tokens are, incorrectly, minted with supplementTokens() by checking ACE balance is as
            // expected
            const sender = accounts[0];
            const recipient1 = accounts[1];
            const delegateAddress = accounts[2];

            const zkAssetAdjustable = await ZkAssetAdjustable.new(ace.address, erc20.address, scalingFactor, 0, [], {
                from: accounts[0],
            });
            const depositOutputNoteValues = [20, 30];
            const depositOutputNotes = await helpers.getNotesForAccount(aztecAccount, depositOutputNoteValues);

            const depositPublicValue = 50;
            const publicValue = depositPublicValue * -1;
            const totalTransfer = scalingFactor.mul(new BN(depositPublicValue)).toNumber();
            await erc20.mint(accounts[0], scalingFactor.mul(new BN(depositPublicValue)), { from: sender });

            const erc20TotalSupply = (await erc20.totalSupply()).toNumber();
            expect(erc20TotalSupply).to.equal(totalTransfer);
            const initialAceBalance = (await erc20.balanceOf(ace.address)).toNumber();
            expect(initialAceBalance).to.equal(0);
            const initialSenderBalance = (await erc20.balanceOf(accounts[0])).toNumber();
            expect(initialSenderBalance).to.equal(totalTransfer);
            const initialRecipientBalance = (await erc20.balanceOf(recipient1)).toNumber();
            expect(initialRecipientBalance).to.equal(0);

            const depositProof = new JoinSplitProof([], depositOutputNotes, sender, publicValue, sender);

            const depositData = depositProof.encodeABI(zkAssetAdjustable.address);
            const depositSignatures = depositProof.constructSignatures(zkAssetAdjustable.address, []);

            await ace.publicApprove(zkAssetAdjustable.address, depositProof.hash, depositPublicValue, { from: sender });

            await erc20.approve(ace.address, scalingFactor.mul(new BN(depositPublicValue)), { from: sender });

            const { receipt: depositReceipt } = await zkAssetAdjustable.methods['confidentialTransfer(bytes,bytes)'](
                depositData,
                depositSignatures,
                {
                    from: sender,
                },
            );
            expect(depositReceipt.status).to.equal(true);

            const intermediateAceBalance = (await erc20.balanceOf(ace.address)).toNumber();
            expect(intermediateAceBalance).to.equal(totalTransfer);

            const erc20TotalSupplyAfterMint = (await erc20.totalSupply()).toNumber();
            expect(erc20TotalSupplyAfterMint).to.equal(totalTransfer);

            const withdrawalPublicValue = 50;
            await confidentialApprove(zkAssetAdjustable, delegateAddress, [0, 1], depositOutputNotes, aztecAccount);

            const withdrawalProof = new JoinSplitProof(
                depositOutputNotes,
                [],
                delegateAddress,
                withdrawalPublicValue,
                recipient1,
            );
            const withdrawalData = withdrawalProof.encodeABI(zkAssetAdjustable.address);

            await ace.validateProof(JOIN_SPLIT_PROOF, delegateAddress, withdrawalData, { from: delegateAddress });
            const { receipt: transferReceipt } = await zkAssetAdjustable.confidentialTransferFrom(
                JOIN_SPLIT_PROOF,
                withdrawalProof.eth.output,
                { from: delegateAddress },
            );
            expect(transferReceipt.status).to.equal(true);

            // Key check that checks total minted, and checks that ACE has not minted
            // more than the inital transfer of tokens to the ACE
            const erc20TotalSupplyAfterWithdrawal = (await erc20.totalSupply()).toNumber();
            expect(erc20TotalSupplyAfterWithdrawal).to.equal(totalTransfer);

            const finalSenderBalance = (await erc20.balanceOf(sender)).toNumber();
            expect(finalSenderBalance).to.equal(0);

            const finalRecipientBalance = (await erc20.balanceOf(recipient1)).toNumber();
            expect(finalRecipientBalance).to.equal(totalTransfer);

            const finalAceBalance = (await erc20.balanceOf(ace.address)).toNumber();
            expect(finalAceBalance).to.equal(0);
        });
    });

    describe('Failure States', () => {
        let ace;
        let erc20;
        let scalingFactor;

        beforeEach(async () => {
            ace = await ACE.at(ACE.address);
            erc20 = await ERC20Mintable.new({ from: accounts[0] });

            erc20 = await ERC20Mintable.new();
            scalingFactor = new BN(10);
        });

        it('should fail if msg.sender is not owner', async () => {
            const zkAssetAdjustable = await ZkAssetAdjustable.new(ace.address, erc20.address, scalingFactor, 0, [], {
                from: accounts[0],
            });

            const sender = accounts[0];
            const { zeroMintCounterNote, newMintCounterNote, mintedNotes } = await getDefaultMintNotes();
            const proof = new MintProof(zeroMintCounterNote, newMintCounterNote, mintedNotes, sender);
            const data = proof.encodeABI();
            await truffleAssert.reverts(zkAssetAdjustable.confidentialMint(MINT_PROOF, data, { from: accounts[1] }));
        });

        it('should fail for unbalanced proof relation, totalInputs !== totalOutputs', async () => {
            const zkAssetAdjustable = await ZkAssetAdjustable.new(ace.address, erc20.address, scalingFactor, 0, [], {
                from: accounts[0],
            });
            const sender = accounts[0];
            const newMintCounterValue = 50;
            const mintedNoteValues = [30, 30];
            const { zeroMintCounterNote, newMintCounterNote, mintedNotes } = await getCustomMintNotes(
                newMintCounterValue,
                mintedNoteValues,
            );
            const proof = new MintProof(zeroMintCounterNote, newMintCounterNote, mintedNotes, sender);
            const data = proof.encodeABI();
            await truffleAssert.reverts(zkAssetAdjustable.confidentialMint(MINT_PROOF, data));
        });
    });
});
