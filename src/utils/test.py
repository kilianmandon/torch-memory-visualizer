import numpy as np

n = 100_000
dataPoints = [np.random.randn(18) for _ in range(n)]

distances = np.zeros((n, n))

for i in range(n):
    for j in range(n):
        distances[i, j] = np.linalg.norm(dataPoints[i] - dataPoints[j])


# (n, 18)
dataPoints = np.random.randn((n, 18))
np.linalg.norm(dataPoints[:, None, :] - dataPoints[None, :, :], axis=-1)