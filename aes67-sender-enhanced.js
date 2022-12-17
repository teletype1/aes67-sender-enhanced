// execute with realtime scheduling
// sudo chrt -f 99 node aes67 --api ALSA -d 3
const os = require('os');
const ptpv2 = require('ptpv2');
const dgram = require('dgram');
const sdp = require('./lib/sdp');
const util = require('./lib/util');
const { Command } = require('commander');
const { RtAudio, RtAudioFormat, RtAudioApi } = require('audify');

//init udp client
const client = dgram.createSocket('udp4');

//command line options
const program = new Command();
program.version('1.0');
program.option('-v, --verbose', 'Enable verbosity');
program.option('--devices', 'List audio devices');
program.option('-d, --device <index>', 'Which audio device to use.  Use --devices to see a list.');
program.option('-m, --mcast <address>', 'First address to multicast the AES67 stream.  Leave space for more addresses if you plan to stream more than 8 channels.'); 
program.option('-n, --streamname <name>', 'Name of AES67 stream(s)');
program.option('-c, --channels <number>', 'Number of Channels');
program.option('-p, --patch <list>', 'Channel Map from the input device, in the order you would like them, separated by commas (i.e. 1,2,3,5,7,8,12, etc)');
program.option('-a, --api <api>', 'Audio API to use (ALSA, OSS, PULSE, JACK, MACOS, ASIO, DS, WASAPI)');
program.option('--address <address>', 'IPv4 address of network interface to use (should be a wired interface)');

program.parse(process.argv);

let logger = function(){};
if(program.verbose){
	logger = console.log;
}

//rtAudio API Connect
let rtAudio;
if(program.api){
	switch(program.api.toLowerCase()){
		case 'alsa':
			rtAudio = new RtAudio(RtAudioApi.LINUX_ALSA);
			break;
		case 'oss':
			rtAudio = new RtAudio(RtAudioApi.LINUX_OSS);
			break;
		case 'pulse':
			rtAudio = new RtAudio(RtAudioApi.LINUX_PULSE);
			break;
		case 'jack':
			rtAudio = new RtAudio(RtAudioApi.UNIX_JACK);
			break;
		case 'macos':
			rtAudio = new RtAudio(RtAudioApi.MACOSX_CORE);
			break;
		case 'asio':
			rtAudio = new RtAudio(RtAudioApi.WINDOWS_ASIO);
			break;
		case 'ds':
			rtAudio = new RtAudio(RtAudioApi.WINDOWS_DS);
			break;
		case 'wasapi':
			rtAudio = new RtAudio(RtAudioApi.WINDOWS_WASAPI);
			break;
		default:
			rtAudio = new RtAudio();
	}
}else{
	rtAudio = new RtAudio();
}
logger('Selected',rtAudio.getApi(),'as audio API.');

// list audio devices when requested on command line
let audioDevices = rtAudio.getDevices();
if(program.devices){
	console.log('Device #, Name, # of Channels');
	for(let i = 0; i < audioDevices.length; i++){
		let device = audioDevices[i];
		if(device.inputChannels > 0){
			console.log(i, device.name, device.inputChannels);
		}
	}
	process.exit();
}

// *** ASSIGN NETWORK ADDRESS
let addr;
if(program.address) {
	if (util.validateIPAddress(program.address)) {
		addr = program.address;
	}
	else {
		console.error('That is an invalid IP address.');
		process.exit();
	}
}
else {
	let interfaces = os.networkInterfaces();
	let interfaceNames = Object.keys(interfaces);
	let addresses = [];

	for(let i = 0; i < interfaceNames.length; i++){
		let interface = interfaces[interfaceNames[i]];
		for(let j = 0; j < interface.length; j++){
			if(interface[j].family == 'IPv4' && interface[j].address != '127.0.0.1'){
				addresses.push(interface[j].address);
			}
		}
	}

	if(addresses.length == 0) {
		console.error('No network interface found!');
		process.exit();
	}

	addr = addresses[0];
}
logger('Selected',addr ,'as network interface');

// *** ASSIGN AUDIO DEVICE
let audioDevice = rtAudio.getDefaultInputDevice();
if (program.device) {
	audioDevice = parseInt(program.device);
}

// set up the number of channels to process and a list of those channels, based on different situations
var channelMap = [];
var highChannel = 0;
if (program.channels && program.patch) { // the user specified both a number of channels and a patch list
	let userPatchList = program.patch.split(',');
	for (let i=0; i < userPatchList.length; i++) {
		channelMap.push(userPatchList[i] - 1);  // this assumes the user thinks of their first channnel as "1" rather than "0"
	}
	if (channelMap.length != program.channels)	{
		console.log('The channel patching list does not match the number of channels specified.');
		process.exit();
	}
}
else if (!program.channels && program.patch) { // user just specified a patch list, we can count the channels from that
	let userPatchList = program.patch.split(',');
	for (let i=0; i < userPatchList.length; i++) {
		channelMap.push(userPatchList[i] - 1);
	}
	program.channels = channelMap.length;
}
else if (program.channels && !program.patch) { // the user just wants the channels in order starting from zero
        for (let i=0; i < program.channels; i++) {
                channelMap.push(i);
        }
}
else {
	// the user didn't specify a patch list or a number of channels, assume 2
	channelMap = [0,1];
	program.channels = 2;
}
highChannel = Math.max(...channelMap) + 1;  // for the rtAudio constructor
logger('Channel input map from the sound card is', channelMap);

const aesFlowChans = []; // place to store the number of channels per flow
let selectedDevice = audioDevices[audioDevice];
let audioChannels;

if(selectedDevice && selectedDevice.inputChannels > 0) {
	logger('Selected device', selectedDevice.name, 'with ', selectedDevice.inputChannels, ' input channels');
	logger('\nWe are trying to put ', channelMap.length, ' channels on the network');
	if (channelMap.length > selectedDevice.inputChannels) {
		console.error('This device doesn\'t have that many input channels!');
		process.exit();
	}
	audioChannels = parseInt(channelMap.length);
	let numAES67Flows = Math.floor(audioChannels / 8);
	if (audioChannels % 8 > 0) {
		numAES67Flows++;
	}
	logger('This will require ', numAES67Flows, ' AES67 flow(s).\n');

	let remainingChannels = audioChannels;
	for (let i=0; i < numAES67Flows; i++) {
		if (remainingChannels % 8 > 0 && remainingChannels / 8 < 1) {
			aesFlowChans[i] = remainingChannels % 8;
		}
		else {
			aesFlowChans[i] = 8;
		}
		remainingChannels = remainingChannels - aesFlowChans[i];
	}
}
else {
	console.error('Invalid audio device!');
	process.exit();
}

// multicast addresses and flow names
const aes67Multicast = [];
const aes67FlowNames = [];
let ipABCD = [];
if (program.mcast) {
	ipABCD = program.mcast.split('.');
}
else {
	ipABCD = ['239','69','1','1'];  // this is the subnet that AES67 likes
}
let baseMCastAddr = ipABCD[3];
let streamName;
if (program.streamname) {
	streamName = program.streamname;
}
else {
	streamName = os.hostname();
}
for (let i = 0; i < aesFlowChans.length; i++) {
	aes67Multicast[i] = ipABCD[0] + '.' + ipABCD[1] + '.' + ipABCD[2] + "." + baseMCastAddr++;
	aes67FlowNames[i] = streamName + '-Bank-' + (i + 1);
}

logger('Selected the following MultiCast Addresses: ', aes67Multicast);
logger('Selected the following names for the AES67 flows: ', aes67FlowNames);

// AES67 params (hardcoded)
const samplerate = 48000;
const ptime = 1;
const fpp = (samplerate / 1000) * ptime;
const encoding = 'L24';
let sessID = Math.round(Date.now() / 1000);
const sessVersion = sessID;
let ptpMaster;

//rtp vars
let seqNum = 0;
let timestampCalc = 0;
let ssrc = sessID % 0x100000000;

//timestamp offset stuff
let offsetSum = 0;
let count = 0;
let correctTimestamp = true;

//open audio stream
logger('Opening audio stream.');
rtAudio.openStream(null, {deviceId: audioDevice, nChannels: highChannel, firstChannel: 0}, RtAudioFormat.RTAUDIO_FLOAT32, samplerate, fpp, streamName, pcm => rtpSend(pcm));


logger('Trying to sync to PTP leader.');
// ptp sync timeout - 10 seconds
setTimeout(function() {
	if(!ptpMaster) {
		console.error('Could not sync to PTP leader. Aborting.');
		process.exit();
	}
}, 10000);

logger('Initializing PTP client');
//init PTP client
ptpv2.init(addr, 0, function(){
	ptpMaster = ptpv2.ptp_master();
	logger('Synced to', ptpMaster, 'successfully');
	//start audio and sdp
	logger('Starting SAP annoucements and audio stream.');
	rtAudio.start();
	sdp.start(addr, aes67Multicast, samplerate, aesFlowChans, encoding, aes67FlowNames, sessID, sessVersion, ptpMaster);
});

// *** PROCESS PCM DATA AND SEND TO THE NETWORK
let floatArray = [];
let outputArray = [];
let rtpSend = function(pcm){
	floatArray.length = 0;
	let chanOffset = 0;
	for(j = 0; j < aesFlowChans.length; j++) {
		// aesFlowChans[j] is the number of channels we need to deal with in AES67 flow
		// the 0th time = channels 0-7
		// the 1th time = channels 8-15
		// the 2th time = channels 16-23
		// the 3th time = channels 24-31 etc.
		// fpp is the number of frames per packet

		//convert 32f to L24 and populate an interleaved buffer, 3 bytes per sample
		let l24 = Buffer.alloc(aesFlowChans[j] * fpp * 3);

		for(let i = 0; i < fpp; i++) {  // keep track of which frame we're on
			let frameOffset = i * (highChannel * 4);
			for (let k = 0; k < aesFlowChans[j]; k++) {  // keep track of which channel we're on
				let channelOffset = channelMap[k + (j * 8)] * 4;
				let samp32 = pcm.readFloatLE(frameOffset + channelOffset);
				let samp24 = ~~(samp32 * 8388607); // scale to the 24-bit data range for audio, no decimals

				// convert the 24-bit sample value to big endian and shove it onto the outgoing PCM data
				let outputBuffOffset = (i * aesFlowChans[j] * 3) + (k * 3);
				l24[outputBuffOffset] = (samp24 & 0xff0000) >>> 16;
				l24[outputBuffOffset + 1] = (samp24 & 0x00ff00) >>> 8;
				l24[outputBuffOffset + 2] = samp24 & 0x0000ff;
			}
		}
		//create RTP header and RTP buffer with header and pcm data
		let rtpHeader = Buffer.alloc(12);
		rtpHeader.writeUInt16BE((1 << 15) + 96, 0);// set version byte and add rtp payload type
		rtpHeader.writeUInt16BE(seqNum, 2);
		rtpHeader.writeUInt32BE(ssrc, 8);

		let rtpBuffer = Buffer.concat([rtpHeader, l24]);

		// timestamp correction stuff
		if(correctTimestamp){
			correctTimestamp = false;
			let ptpTime = ptpv2.ptp_time();
			let timestampRTP = ((ptpTime[0] * samplerate) + Math.round((ptpTime[1] * samplerate) / 1000000000)) % 0x100000000;
			timestampCalc = Math.floor(timestampRTP / fpp)*fpp;
		}

		//write timestamp
		rtpBuffer.writeUInt32BE(timestampCalc, 4);

		//send RTP packet
		client.send(rtpBuffer, 5004, aes67Multicast[j]);
	}

	//timestamp average stuff
	let ptpTime = ptpv2.ptp_time();
	let timestampRTP = ((ptpTime[0] * samplerate) + Math.round((ptpTime[1] * samplerate) / 1000000000)) % 0x100000000;
	offsetSum += Math.abs(timestampRTP - timestampCalc);
	count++;

	// increase timestamp and seqnum
	seqNum = (seqNum + 1) % 0x10000;
	timestampCalc = (timestampCalc + fpp) % 0x100000000;

}

// Interval for timestamp correction calculation
// the original aes67.js by Phil Hartung did this every 100ms, but that seems too often, changed to 1 sec
setInterval(function(){
	let avg = Math.round(offsetSum / count);
	if(avg > fpp){
		correctTimestamp = true;
		let offsetMS = Math.round(avg / fpp * 1000) / 1000;
		logger('Resycing PTP and RTP timestamp. Offset was '+offsetMS+'ms.');
	}
	offsetSum = 0;
	count = 0;
}, 1000);


// *** CATCH TERMINATION SIGNALS
['SIGINT', 'SIGTERM', 'SIGQUIT']
  .forEach(signal => process.on(signal, () => {
	logger('Stopping SDP announcements...');
        sdp.stop();
        logger('Stopping Audio Streams...');
	rtAudio.stop();
	rtAudio.closeStream();
    process.exit();
  }));
