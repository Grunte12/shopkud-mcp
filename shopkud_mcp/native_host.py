#!/usr/bin/python3
"""Chrome native messaging relay. No CLI executor, Tincan, LLM or network host."""
import argparse
import json
import os
from pathlib import Path
import selectors
import socket
import stat
import struct
import sys

MAX=512000


def read_frame(stream):
    header=stream.read(4)
    if not header: return None
    while len(header)<4:
        chunk=stream.read(4-len(header))
        if not chunk: raise ValueError("invalid_frame")
        header+=chunk
    size=struct.unpack("=I",header)[0]
    if not 1 <= size <= MAX: raise ValueError("invalid_frame")
    data=bytearray()
    while len(data)<size:
        chunk=stream.read(size-len(data))
        if not chunk: raise ValueError("invalid_frame")
        data.extend(chunk)
    value=json.loads(data)
    if not isinstance(value,dict): raise ValueError("invalid_frame")
    return value


def write_frame(stream,value):
    body=json.dumps(value,separators=(",",":")).encode()
    if len(body)>MAX: raise ValueError("invalid_frame")
    pending=memoryview(struct.pack("=I",len(body))+body)
    while pending:
        written=stream.write(pending)
        if not written: raise ValueError("invalid_frame")
        pending=pending[written:]
    stream.flush()


def run(config_path,origin):
    path=Path(config_path)
    info=path.lstat(); directory=path.parent.lstat()
    if (path.resolve()!=path or not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode)!=0o600
            or info.st_uid!=os.getuid() or info.st_nlink!=1 or info.st_size>8192
            or not stat.S_ISDIR(directory.st_mode) or stat.S_IMODE(directory.st_mode)!=0o700
            or directory.st_uid!=os.getuid()):
        raise ValueError("configuration_invalid")
    config=json.loads(path.read_text())
    if origin not in config["allowed_origins"]: raise ValueError("origin_rejected")
    sock_path=Path(config["socket_path"])
    if sock_path.parent!=path.parent or sock_path.name!="native.sock": raise ValueError("configuration_invalid")
    info=sock_path.lstat()
    if not stat.S_ISSOCK(info.st_mode) or info.st_uid!=os.getuid() or stat.S_IMODE(info.st_mode)!=0o600:
        raise ValueError("connection_unavailable")
    with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as connection:
        connection.settimeout(5); connection.connect(str(sock_path))
        channel=connection.makefile("rwb",buffering=0)
        write_frame(channel,{"type":"hello","origin":origin})
        ack=read_frame(channel)
        if ack!={"type":"hello-ack"}: raise ValueError("connection_unavailable")
        connection.settimeout(None)
        write_frame(sys.stdout.buffer,ack)
        chrome_input=sys.stdin.buffer.raw
        with selectors.DefaultSelector() as selector:
            selector.register(chrome_input,selectors.EVENT_READ,"chrome")
            selector.register(connection,selectors.EVENT_READ,"broker")
            while True:
                for key,_ in selector.select():
                    source=chrome_input if key.data=="chrome" else channel
                    target=channel if key.data=="chrome" else sys.stdout.buffer
                    message=read_frame(source)
                    if message is None: return
                    write_frame(target,message)


def main():
    parser=argparse.ArgumentParser(add_help=False)
    parser.add_argument("--config",required=True)
    parser.add_argument("origin")
    args=parser.parse_args()
    try: run(args.config,args.origin)
    except (OSError,ValueError,KeyError,TypeError):
        # Fixed diagnostic only; never stdout noise, private paths or tokens.
        write_frame(sys.stdout.buffer,{"type":"bridge-error","error":"native_connection_unavailable"})


if __name__=="__main__": main()
