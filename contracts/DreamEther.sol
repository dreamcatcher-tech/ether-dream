// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

// Uncomment this line to use console.log
import "hardhat/console.sol";

contract DreamEther {
    uint public nextPacketID = 0;

    // store all the Packets
    // make a struct for each packet
    struct Packet {
        PacketType packetType;
        PacketState packetState;
        uint datahash;
        mapping(uint => uint) shares;
        // https://ethereum.stackexchange.com/questions/87451/solidity-error-struct-containing-a-nested-mapping-cannot-be-constructed
    }

    /**
     * @notice
     * id is always a multiple of 7, as each packet has 7 share types.
     */
    mapping(uint => Packet) public packets;

    // track balance of each address for reverse lookup
    mapping(address => mapping(uint => uint)) public balanceOf;

    enum PacketType {
        Application,
        Problem,
        Solution
    }
    enum PacketState {
        Proposing,
        Open,
        Resolved
    }
    enum ShareType {
        Proposal,
        ProposalQA,
        Funding,
        Buying,
        Solution,
        SolutionQA,
        Correction
    }

    event PacketOpened(uint packetID, uint datahash);
    event PacketUpdated(uint packetID, uint datahash);
    event PacketResolved(uint packetID, uint datahash);

    function proposePacket(
        PacketType packetType,
        uint datahash
    )
        public
        returns (
            // uint qaID
            uint packetID
        )
    {
        packetID = nextPacketID;
        nextPacketID += 1;

        packets[packetID] = Packet({
            packetType: packetType,
            packetState: PacketState.Proposing,
            datahash: datahash
        });

        emit PacketOpened(packetID, datahash);
    }

    // how to track solutions that have been proposed ?
    // merging of packets with other ones ?

    function payProposalQA(uint packetID) public payable {
        // a payment in Ether is sent along with the transaction
    }

    function solve(uint packetID, uint solutionHash) public {
        // a solution is proposed
    }

    // function withdraw() public {
    //     // Uncomment this line, and the import of "hardhat/console.sol", to print a log in your terminal
    //     console.log("Unlock time is %o and block timestamp is %o");

    //     require(block.timestamp >= unlockTime, "You can't withdraw yet");
    //     require(msg.sender == owner, "You aren't the owner");

    //     emit Withdrawal(address(this).balance, block.timestamp);

    //     owner.transfer(address(this).balance);
    // }
}
