# AES67 Sender Enhanced
This program expands on the original work by https://github.com/philhartung to make soundcard input available on an AES67 network. 
The enhanced edition adds support for channel mapping as well as the automatic creation of multiple AES67 flows when needed.
This software also properly converts 32-bit floating point audio from the soundcard into actual 24-bit audio as specified in AES67, making it suitable for professional audio applications.

## Installation
To install aes67-sender, clone the repository and install the dependencies.
```
git clone https://github.com/teletype1/aes67-sender-enhanced.git
cd aes67-sender-enhanced
npm install
```
Audify (audio backend used) prebuilds are available for most major platforms and Node versions. If you need to build Audify from source, see https://github.com/almogh52/audify#requirements-for-source-build.

## Usage
To display the help, execute `node aes67 --help`:
```
Usage: aes67 [options]

Options:
  -V, --version            output the version number
  -v, --verbose            enable verbosity
  --devices                List audio devices
  -d, --device <index>     Which audio device to use.  Use --devices to see a list and corresponding device index numbers.
  -m, --mcast <address>    First address to multicast the AES67 stream.  Leave space for more addresses if you plan to stream more than 8 channels.
  -n, --streamname <name>  name of AES67 stream(s).  "-Bank-" will automatically be added with a bank number, corresponding to groups of 8 channels.
  -c, --channels <number>  number of channels
  -p, --patch <list>       Channel Map from the input device, in the order you would like them, separated by commas. (i.e., 1,2,3,5,7,8,12,etc).
                           Channels do not need to be in the order they come from the soundcard, and can be repeated.
  -a, --api <api>          audio api (ALSA, OSS, PULSE, JACK, MACOS, ASIO, DS, WASAPI)
  --address <address>      IPv4 address of network interface
  -h, --help               display help for command
```

The software has to be executed with priviliges, because the PTP client binds to ports below 1024.
## Test Environment
This software was tested with a Midas M32R connected via USB to a 2011 iMac.  Using that equipment I was successfully able to put 32 channels of audio onto the network and recieve them using Ravenna Virtual Soundcard on MacOS Ventura, and record to Pro Tools.  I was also able to use Dante Controller to send the channels to another console (a SoundCraft Si Impact with a Dante Card).  

### Latency considerations (from philhartung's original version)
In practice low latency is important. Especially when working in a hybrid Dante/AES67 network, latency should be under 2ms. Dante devices are fixed to a maximum of 2ms latency and drop packets with higher latency. With a Raspberry Pi, latency jitter is quite high. A lot/too many packets are dropped because latency is too high when sending audio to a Dante receiver. 
### Latency Notes from me
In my experience there was very little (if any) packet loss from the iMac, even with its age.  I will continue to test the software on newer machines and perhaps an RPi (if I can get one!). The network used for testing is installed at The Loft Live, a music venue in Columbus, GA, using their consoles and computers for development.  The network uses one managed switch and two satellite gigabit unmanaged switches with WiFi APs next to the consoles.  All of the networking equipment is off-the-shelf, made by Netgear.
