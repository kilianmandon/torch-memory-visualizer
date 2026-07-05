"""
receiver.py

A convenience module that calls the Peer-to-Peer file sharing tool croc in receiving mode in a loop, saving all incoming files that were send with the specific share_code.

Designed for this scenario:
You are running your ML experiments on a remote instance and want to visualize your memory snapshots. 
Then, you let this program idle on your local machine:
```
snapkit-receive your_secret_code
```
On the remote machine, you use the memory snapshot tool with share=True:
```
with memory_snapshot('test_run', share=True, share_code='your_secret_code'):
    ... your PyTorch code
```
Now, all your snapshots will be automatically downloaded to your local machine so you can inspect them.
"""
import os
import shutil
import subprocess
import time
import argparse

def start_receiving(share_code: str):
    if shutil.which('croc') is None:
        raise ValueError("""File download uses croc, which is not available. Install croc using "curl https://getcroc.schollz.com | bash".""")

    print(f'Starting to poll with share code {share_code}...')
    try:
        while True:
            env = os.environ.copy()
            env["CROC_SECRET"] = share_code
            process = subprocess.run(['croc', '--yes', '--overwrite'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env)
            if process.returncode==0:
                print('File download successful.')
            time.sleep(5)
    except KeyboardInterrupt:
        print('Stopped listening for snapshots.')

def main():
    parser = argparse.ArgumentParser(prog='Snapshot File Receiver', usage='snapkit-receive your_secret_code', description='Calls croc in a loop until and downloads all snapshots send under your secret code. Make sure to use a good secret!')
    parser.add_argument('share_code')
    args = parser.parse_args()
    start_receiving(args.share_code)

if __name__=='__main__':
    main()