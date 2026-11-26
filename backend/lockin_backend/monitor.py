"""CPU/GPU resource monitor. GPU stats come from NVML (nvidia-ml-py) if installed,
otherwise from the `nvidia-smi` CLI; absent both, gpu_available=False."""
from __future__ import annotations

import logging
import shutil
import subprocess

import psutil

from .schemas import SystemStats

log = logging.getLogger(__name__)


class SystemMonitor:
    def __init__(self) -> None:
        self._nvml = None
        self._handle = None
        self._smi = shutil.which("nvidia-smi")
        try:
            import pynvml  # provided by nvidia-ml-py
            pynvml.nvmlInit()
            self._handle = pynvml.nvmlDeviceGetHandleByIndex(0)
            self._nvml = pynvml
        except Exception:  # noqa: BLE001
            self._nvml = None
        psutil.cpu_percent(None)  # prime

    def _gpu(self) -> dict:
        if self._nvml is not None:
            try:
                n, h = self._nvml, self._handle
                mem = n.nvmlDeviceGetMemoryInfo(h)
                name = n.nvmlDeviceGetName(h)
                return dict(gpu_available=True, gpu_name=name.decode() if isinstance(name, bytes) else name,
                            gpu_util_percent=float(n.nvmlDeviceGetUtilizationRates(h).gpu),
                            gpu_mem_used_mb=mem.used / 2**20, gpu_mem_total_mb=mem.total / 2**20,
                            gpu_temp_c=float(n.nvmlDeviceGetTemperature(h, 0)))
            except Exception:  # noqa: BLE001
                pass
        if self._smi:
            try:
                out = subprocess.run(
                    [self._smi, "--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu",
                     "--format=csv,noheader,nounits"], capture_output=True, text=True, timeout=2).stdout
                name, util, used, total, temp = [x.strip() for x in out.splitlines()[0].split(",")]
                return dict(gpu_available=True, gpu_name=name, gpu_util_percent=float(util),
                            gpu_mem_used_mb=float(used), gpu_mem_total_mb=float(total), gpu_temp_c=float(temp))
            except Exception:  # noqa: BLE001
                pass
        return dict(gpu_available=False)

    def sample(self) -> SystemStats:
        return SystemStats(cpu_percent=psutil.cpu_percent(None), ram_percent=psutil.virtual_memory().percent,
                           **self._gpu())
