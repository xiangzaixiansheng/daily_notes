

1、查看数据库的隔离级别

```
show variables like 'tx_isolation';
```



2、查看数据库的主备情况

```
show variables like ‘read_only’;--------off是主库，on为从库
```

