const { errors } = require('@aztec/dev-utils');
const secp256k1 = require('@aztec/secp256k1');
const BN = require('bn.js');
const { expect } = require('chai');
const { randomHex } = require('web3-utils');
const sinon = require('sinon');

const { PrivateRangeProof } = require('../../../src/proof');
const PrivateRangeVerifier = require('../../../src/proof/privateRange/verifier');
const note = require('../../../src/note');
const { Proof } = require('../../../src/proof');

describe('Private range proof Verifier', () => {
    const { publicKey } = secp256k1.generateAccount();
    const sender = randomHex(20);
    let originalNote = {};
    const originalNoteValue = 10;
    let comparisonNote = {};
    const comparisonNoteValue = 4;
    let utilityNote = {};
    const utilityNoteValue = 6;

    before(async () => {
        originalNote = await note.create(publicKey, originalNoteValue);
        comparisonNote = await note.create(publicKey, comparisonNoteValue);
        utilityNote = await note.create(publicKey, utilityNoteValue);
    });

    describe('Success States', () => {
        it('should verify a valid private range proof', async () => {
            const proof = new PrivateRangeProof(originalNote, comparisonNote, utilityNote, sender);
            const verifier = new PrivateRangeVerifier(proof);
            verifier.verifyProof();
            expect(verifier.isValid).to.equal(true);
        });

        it('should verify when a comparison note of zero value is used', async () => {
            const zeroValueNote = await note.create(publicKey, 0);
            const adjustedUtilityNote = await note.create(publicKey, 10);

            const proof = new PrivateRangeProof(originalNote, zeroValueNote, adjustedUtilityNote, sender);
            const verifier = new PrivateRangeVerifier(proof);
            verifier.verifyProof();
            expect(verifier.isValid).to.equal(true);
        });
    });

    describe('Success States', () => {
        let validateInputsStub;

        before(() => {
            validateInputsStub = sinon.stub(Proof.prototype, 'validateInputs').callsFake(() => {});
        });

        after(() => {
            validateInputsStub.restore();
        });

        it('should throw error if unsatisfied proof relations', async () => {
            const bogusComparisonValue = 5;
            const bogusComparisonNote = await note.create(publicKey, bogusComparisonValue);
            const proof = new PrivateRangeProof(originalNote, bogusComparisonNote, utilityNote, sender, false);

            const verifier = new PrivateRangeVerifier(proof);
            verifier.verifyProof();
            expect(verifier.isValid).to.equal(false);
            expect(verifier.errors.length).to.equal(1);
            expect(verifier.errors[0]).to.equal(errors.codes.CHALLENGE_RESPONSE_FAIL);
        });

        it('should fail if malformed challenge', async () => {
            const proof = new PrivateRangeProof(originalNote, comparisonNote, utilityNote, sender);
            proof.challenge = new BN(randomHex(31), 16);

            const verifier = new PrivateRangeVerifier(proof);
            verifier.verifyProof();
            expect(verifier.isValid).to.equal(false);
            expect(verifier.errors.length).to.equal(1);
            expect(verifier.errors[0]).to.equal(errors.codes.CHALLENGE_RESPONSE_FAIL);
        });
    });
});
