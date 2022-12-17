var dgram = require('dgram');
var socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

var constructSDPMsg = function(addr, multicastAddr, samplerate, channels, encoding, name, sessID, sessVersion, ptpMaster){
	var sapHeader = Buffer.alloc(8);

	//write version/options - RFC 2974
	sapHeader.writeUInt8(0x20);  // decimal value is 32 or 00100000
					// bits 1-3 of the SAP header should 001 (version 1)
					// bit 4 "A" Address Type = 0 means IPV4
					// bit 5 "R" Reserved = 0 must be zero
					// bit 6 "T" Message Type = 0 for announcement packet, 1 for deletion
					// bit 7 "E" Encryption = 0 not encrypted
					// but 8 "C" Compressed = 0 not compressed
	// up to this point we have only written 1 byte, with the above information
	// the next byte in the SAP header is the authentication length, 8-bit unsigned integer
	// of the number of 32-bit words that follow the header for authentication data.
	// We are not using this here so skip it, and start the next bit at byte offset 2 (auth length occupies 1 byte)

	//write hash - byte position 2
	// Message ID hash - a unique identifier to incidate the precise version of the announcement
	let hash = Math.floor(Math.random() * 65536); // the chance of generating the same hash is very small, prob not the best solution though
	sapHeader.writeUInt16LE(hash, 2);

	//write source IP address into the SAP header, 32 bits
	var ip = addr.split('.');
	sapHeader.writeUInt8(parseInt(ip[0]), 4);
	sapHeader.writeUInt8(parseInt(ip[1]), 5);
	sapHeader.writeUInt8(parseInt(ip[2]), 6);
	sapHeader.writeUInt8(parseInt(ip[3]), 7);

	// the payload MIME type, the next bit of the SAP header, terminated by a null (\0)
	var sapContentType = Buffer.from('application/sdp\0');

	// the actual payload, an SDP-formatted message
	var sdpConfig = [
		'v=0',
		'o=- '+sessID+' '+sessVersion+' IN IP4 '+addr,
		's='+name,
		'c=IN IP4 '+multicastAddr+'/32',
		't=0 0',
		'a=clock-domain:PTPv2 0',
		'm=audio 5004 RTP/AVP 96',
		'a=rtpmap:96 '+encoding+'/'+samplerate+'/'+channels,
		'a=sync-time:0',
		'a=framecount:48',
		'a=ptime:1',
		'a=mediaclk:direct=0',
		'a=ts-refclk:ptp=IEEE1588-2008:'+ptpMaster,
		'a=recvonly',
		''
	];
	var sdpBody = Buffer.from(sdpConfig.join('\r\n'));

	return Buffer.concat([sapHeader, sapContentType, sdpBody]);
}

exports.start = function(addr, multicastAddr, samplerate, channels, encoding, name, sessID, sessVersion, ptpMaster){
	sdpMSG = [];
	for (i=0; i < multicastAddr.length; i++) {
		sdpMSG[i] = constructSDPMsg(addr, multicastAddr[i], samplerate, channels[i], encoding, name[i], sessID, sessVersion, ptpMaster);
		sessID++;
	}

	socket.bind(9875, function(){
		socket.setMulticastInterface(addr);
		for (i=0; i < sdpMSG.length; i++) {
			socket.send(sdpMSG[i], 9875, '239.255.255.255', function(err){});
		}
	});

	setInterval(function(){
		for (i=0; i < sdpMSG.length; i++) {
			socket.send(sdpMSG[i], 9875, '239.255.255.255', function(err){});
		}
	}, 30*1000); // rebroadcast the announcements every 30 seconds
}

exports.stop = function() {
	// this actually won't work - because we are not using an authentication method in the SAP header
	// something to work on going forward - for now we will just have to wait for the announcements to time out on each client
	// an SDP deletion packet puts a "1" in bit position 6 of the first byte of the packet
	for(i=0; i < sdpMSG.length; i++) {
		sdpMSG[i].writeUInt8(0x24);
	}
	// retransmit the announcements with the deletion bits included
	for (i=0; i < sdpMSG.length; i++) {
		socket.send(sdpMSG[i], 9875, '239.255.255.255', function(err){});
	}
}

